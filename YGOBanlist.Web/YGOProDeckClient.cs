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
            var deckinfo = await httpClient.GetFromJsonAsync<DeckInfo[]>($"/api/decks/getDecks.php?&_sft_category=tournament%20meta%20decks&from=2022-12-15&to=2023-12-15&limit=20&offset={offset}");
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


        var sortedCardCounts = _cardCounts.OrderByDescending(kvp => kvp.Value).Select(kvp => (kvp.Key, kvp.Value));

        HttpClient dbYgoClient = new HttpClient
        {
            BaseAddress = new Uri("https://db.ygoprodeck.com")
        };

        // Remove staples
        // https://db.ygoprodeck.com/api/v7/cardinfo.php?staple=yes
        var staples = (await dbYgoClient.GetFromJsonAsync<Root>($"/api/v7/cardinfo.php?staple=yes")).data;

        sortedCardCounts = sortedCardCounts.Where(scc => staples.Any(s => s.id == scc.Key) == false);


        // Use subset of ids since the request is otherwise too large
        var allCardInfo = Enumerable.Empty<Datum>();
        foreach (var chunk in IterateInChunks<(int, int)>(sortedCardCounts, 50))
        {
            var allIdsCommaSeparated = string.Join(",", chunk.Select(c => c.Item1));
            allCardInfo = allCardInfo.Concat((await dbYgoClient.GetFromJsonAsync<Root>($"/api/v7/cardinfo.php?id={allIdsCommaSeparated}")).data);
            Thread.Sleep(5);
        }

        var maxValue = sortedCardCounts.Take(10).Sum((input) => input.Value) / 10.0;
        var result = new List<CardPower>();
        foreach (var card in sortedCardCounts)
        {
            var powerlevel = (int)Math.Min(100, card.Value / maxValue * 100);
            var cardName = allCardInfo.FirstOrDefault(ci => ci.id == card.Key)?.name ?? "Unknown card";
            result.Add(new CardPower(cardName, card.Value, powerlevel, GetStatusBasedOnPowerLevel(powerlevel)));
        }

        return result;
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

    private string GetStatusBasedOnPowerLevel(int powerlevel)
    {
        if (powerlevel > 50)
        {
            return "BANNED";
        }
        if (powerlevel > 30)
        {
            return "LIMITED";
        }
        if (powerlevel > 10)
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
