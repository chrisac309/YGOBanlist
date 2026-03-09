using Newtonsoft.Json;

namespace YGOBanlist.Web;

public class YGOProDeckClient(HttpClient httpClient)
{
    private Dictionary<int, int> _cardCounts = new Dictionary<int, int>();

    public async Task<IEnumerable<CardPower>> GetCardPowerFromPastYear()
    {
        var lastThousandTournamentDecks = Enumerable.Empty<DeckInfo>();
        var offset = 0;
        while (offset <= 1000)
        {
            var deckinfo = await httpClient.GetFromJsonAsync<DeckInfo[]>($"/api/decks/getDecks.php?&_sft_category=tournament%20meta%20decks&from=2025-03-09&to=2026-03-09&limit=20&offset={offset}");
            foreach (var deck in deckinfo)
            {
                lastThousandTournamentDecks = lastThousandTournamentDecks.Append(deck);
            }

            offset += 20;
            Thread.Sleep(5);
        }

        foreach (var deckInfo in lastThousandTournamentDecks)
        {
            // Parse the main deck
            var currentParsedDeck = ParseDeck(deckInfo.main_deck);
            AddToDictionary(currentParsedDeck);

            // Parse the extra deck
            currentParsedDeck = ParseDeck(deckInfo.extra_deck);
            AddToDictionary(currentParsedDeck);

            // Parse the side deck
            currentParsedDeck = ParseDeck(deckInfo.side_deck);
            AddToDictionary(currentParsedDeck);
        }
        
        HttpClient dbYgoClient = new HttpClient
        {
            BaseAddress = new Uri("https://db.ygoprodeck.com")
        };

        // banlist - Filter the cards by banlist (TCG, OCG, Goat).
        var currentBanlistCards = (await dbYgoClient.GetFromJsonAsync<Root>($"/api/v7/cardinfo.php?banlist=TCG")).data;

        // https://db.ygoprodeck.com/api/v7/cardinfo.php?staple=yes
        var staples = (await dbYgoClient.GetFromJsonAsync<Root>($"/api/v7/cardinfo.php?staple=yes")).data;

        // Remove current banlist cards from sorted set
        var sortedCardCounts = _cardCounts.Where(cc => !currentBanlistCards.Any(cbc => cbc.id == cc.Key)).OrderByDescending(kvp => kvp.Value).Select(kvp => (kvp.Key, kvp.Value));

        // We'll rate staples differently
        var staplesInParsedData = sortedCardCounts.Where(scc => staples.Any(s => s.id == scc.Key) == true);

        // Remove staples
        sortedCardCounts = sortedCardCounts.Where(scc => staples.Any(s => s.id == scc.Key) == false);

        var nonStaplesCardInfo = await GetCardInfo(dbYgoClient, sortedCardCounts);
        var staplesCardInfo = await GetCardInfo(dbYgoClient, staplesInParsedData);
        
        var maxValue = (double)sortedCardCounts.First().Value;
        var result = new List<CardPower>();
        foreach (var (Key, Value) in sortedCardCounts)
        {
            var powerlevel = (int)Math.Min(100, Value / maxValue * 100);
            var cardName = nonStaplesCardInfo.FirstOrDefault(ci => ci.id == Key)?.name ?? "Unknown card";
            var status = GetStatusBasedOnPowerLevel(powerlevel);
            if (status != "UNLIMITED")
            {
                result.Add(new CardPower(cardName, Value, powerlevel, status));
            }
        }

        var staplesMaxValue = (double) staplesInParsedData.First().Value;
        foreach (var (Key, Value) in staplesInParsedData)
        {
            var powerlevel = (int)Math.Min(100, Value / staplesMaxValue * 100);
            var cardName = staplesCardInfo.FirstOrDefault(ci => ci.id == Key)?.name ?? "Unknown card";
            var status = GetStapleStatusBasedOnPowerLevel(powerlevel);
            if (status != "UNLIMITED")
            {
                result.Add(new CardPower(cardName, Value, powerlevel, status + "*"));
            }
        }

        return result
            .GroupBy(item => item.name)
            .Select(group => group.OrderByDescending(item => item.count).First())
            .OrderBy(t => t.status)
            .ThenBy(t => t.name);
    }

    private static async Task<IEnumerable<Datum>> GetCardInfo(HttpClient dbYgoClient, IEnumerable<(int Key, int Value)> sortedCardCounts)
    {
        // Use subset of ids since the request is otherwise too large
        var allCardInfo = Enumerable.Empty<Datum>();
        foreach (var chunk in IterateInChunks<(int, int)>(sortedCardCounts, 50))
        {
            var allIdsCommaSeparated = string.Join(",", chunk.Select(c => c.Item1));
            allCardInfo = allCardInfo.Concat((await dbYgoClient.GetFromJsonAsync<Root>($"/api/v7/cardinfo.php?id={allIdsCommaSeparated}")).data);
            Thread.Sleep(5);
        }

        return allCardInfo;
    }

    static IEnumerable<IEnumerable<T>> IterateInChunks<T>(IEnumerable<T> collection, int chunkSize)
    {
        var enumerator = collection.GetEnumerator();
        while (enumerator.MoveNext())
        {
            yield return GetChunk(enumerator, chunkSize);
        }
    }

    static IEnumerable<T> GetChunk<T>(IEnumerator<T> enumerator, int chunkSize)
    {
        do
        {
            yield return enumerator.Current;
        } while (--chunkSize > 0 && enumerator.MoveNext());
    }

    private string GetStapleStatusBasedOnPowerLevel(int powerlevel)
    {
        if (powerlevel >= 90)
        {
            return "BANNED";
        }
        if (powerlevel >= 45)
        {
            return "LIMITED";
        }
        if (powerlevel >= 30)
        {
            return "SEMI-LIMITED";
        }
        return "UNLIMITED";
    }

    private string GetStatusBasedOnPowerLevel(int powerlevel)
    {
        if (powerlevel >= 30)
        {
            return "BANNED";
        }
        if (powerlevel >= 15)
        {
            return "LIMITED";
        }
        if (powerlevel >= 10)
        {
            return "SEMI-LIMITED";
        }
        return "UNLIMITED";
    }

    private IEnumerable<int> ParseDeck(string deckJsonAsString)
    {
        if (deckJsonAsString == null)
        {
            return Enumerable.Empty<int>();
        }
        // Deserialize the JSON array into a List<string>
        List<string> stringValues = JsonConvert.DeserializeObject<List<string>>(deckJsonAsString);

        // Convert each string value to an integer and return the IEnumerable<int>
        return stringValues.Select(int.Parse);
    }

    private void AddToDictionary(IEnumerable<int> cardIds)
    {
        foreach (var id in cardIds)
        {
            if (_cardCounts.ContainsKey(id))
            {
                _cardCounts[id]++;
            }
            else
            {
                _cardCounts[id] = 1;
            }
        }
    }

    private enum BanlistStatus
    {
        Unlimited,
        SemiLimited,
        Limited,
        Banned
    }
}



public record CardPower(string name, int count, int power, string status)
{
}

public class Root
{
    public Datum[] data { get; set; }
}

public class Datum
{
    public int id { get; set; }
    public string name { get; set; }
}


public class DeckInfo
{
    /// <summary>
    /// Contains info about the cards in the deck by ID
    /// </summary>
    public string main_deck { get; set; }

    /// <summary>
    /// Contains info about the cards in the extra deck by ID
    /// </summary>
    public string extra_deck { get; set; }

    /// <summary>
    /// Contains info about the cards in the side deck by ID
    /// </summary>
    public string side_deck { get; set; }
}
