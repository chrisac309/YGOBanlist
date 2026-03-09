/**
 * YGOProDeck Client - JavaScript translation of YGOProDeckClient.cs
 * Fetches tournament meta deck data from ygoprodeck.com API and calculates
 * card power levels for a supplemental banlist.
 */
const YGOProDeckClient = (() => {
    const DECK_API_BASE = "https://ygoprodeck.com";
    const DB_API_BASE = "https://db.ygoprodeck.com";
    const CARD_IMAGE_BASE = "https://images.ygoprodeck.com/images/cards_small";

    /**
     * Get the card image URL for a given card ID.
     */
    function getCardImageUrl(cardId) {
        return `${CARD_IMAGE_BASE}/${cardId}.jpg`;
    }

    /**
     * Parse a deck JSON string into an array of card IDs (integers).
     * Mirrors C# ParseDeck method.
     */
    function parseDeck(deckJsonAsString) {
        if (!deckJsonAsString) {
            return [];
        }
        const stringValues = JSON.parse(deckJsonAsString);
        return stringValues.map(val => parseInt(val, 10));
    }

    /**
     * Add card IDs to the counts dictionary.
     * Mirrors C# AddToDictionary method.
     */
    function addToDictionary(cardCounts, cardIds) {
        for (const id of cardIds) {
            cardCounts[id] = (cardCounts[id] || 0) + 1;
        }
    }

    /**
     * Determine ban status based on power level for non-staple cards.
     * Mirrors C# GetStatusBasedOnPowerLevel method.
     */
    function getStatusBasedOnPowerLevel(powerlevel) {
        if (powerlevel >= 30) return "BANNED";
        if (powerlevel >= 15) return "LIMITED";
        if (powerlevel >= 10) return "SEMI-LIMITED";
        return "UNLIMITED";
    }

    /**
     * Determine ban status based on power level for staple cards.
     * Mirrors C# GetStapleStatusBasedOnPowerLevel method.
     */
    function getStapleStatusBasedOnPowerLevel(powerlevel) {
        if (powerlevel >= 90) return "BANNED";
        if (powerlevel >= 45) return "LIMITED";
        if (powerlevel >= 30) return "SEMI-LIMITED";
        return "UNLIMITED";
    }

    /**
     * Split an array into chunks of a given size.
     * Mirrors C# IterateInChunks method.
     */
    function chunkArray(array, chunkSize) {
        const chunks = [];
        for (let i = 0; i < array.length; i += chunkSize) {
            chunks.push(array.slice(i, i + chunkSize));
        }
        return chunks;
    }

    /**
     * Fetch card info from db.ygoprodeck.com in chunks of 50 IDs.
     * Mirrors C# GetCardInfo method.
     */
    async function getCardInfo(sortedCardCounts) {
        let allCardInfo = [];
        const chunks = chunkArray(sortedCardCounts, 50);

        for (const chunk of chunks) {
            const ids = chunk.map(c => c.id).join(",");
            const response = await fetch(`${DB_API_BASE}/api/v7/cardinfo.php?id=${ids}`);
            if (response.ok) {
                const result = await response.json();
                if (result.data) {
                    allCardInfo = allCardInfo.concat(result.data);
                }
            }
            // Small delay for rate limiting
            await new Promise(resolve => setTimeout(resolve, 50));
        }

        return allCardInfo;
    }

    /**
     * Main method: fetch tournament decks and calculate card power levels.
     * Mirrors C# GetCardPowerFromPastYear method.
     * @param {function} onProgress - Callback for progress updates (0-100)
     */
    async function getCardPowerFromPastYear(onProgress) {
        const cardCounts = {};
        const allDecks = [];

        // Calculate date range (past year from today)
        const today = new Date();
        const oneYearAgo = new Date(today);
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
        const fromDate = oneYearAgo.toISOString().split("T")[0];
        const toDate = today.toISOString().split("T")[0];

        // Fetch last 1000 tournament meta decks (paginated, 20 at a time)
        let offset = 0;
        const totalSteps = 51 + 3; // 51 deck fetches + 3 additional API calls
        let currentStep = 0;

        while (offset <= 1000) {
            const url = `${DECK_API_BASE}/api/decks/getDecks.php?&_sft_category=tournament%20meta%20decks&from=${fromDate}&to=${toDate}&limit=20&offset=${offset}`;
            try {
                const response = await fetch(url);
                if (response.ok) {
                    const decks = await response.json();
                    if (Array.isArray(decks)) {
                        allDecks.push(...decks);
                    }
                }
            } catch (e) {
                // Continue on network errors for individual pages
                console.warn(`Failed to fetch decks at offset ${offset}:`, e);
            }

            offset += 20;
            currentStep++;
            if (onProgress) {
                onProgress(Math.round((currentStep / totalSteps) * 100), `Fetching decks (${offset}/1020)...`);
            }
            // Small delay for rate limiting
            await new Promise(resolve => setTimeout(resolve, 50));
        }

        // Parse all decks and count card appearances
        for (const deckInfo of allDecks) {
            addToDictionary(cardCounts, parseDeck(deckInfo.main_deck));
            addToDictionary(cardCounts, parseDeck(deckInfo.extra_deck));
            addToDictionary(cardCounts, parseDeck(deckInfo.side_deck));
        }

        if (onProgress) {
            onProgress(Math.round((++currentStep / totalSteps) * 100), "Fetching current banlist...");
        }

        // Fetch current TCG banlist cards
        let currentBanlistCards = [];
        try {
            const banlistResponse = await fetch(`${DB_API_BASE}/api/v7/cardinfo.php?banlist=TCG`);
            if (banlistResponse.ok) {
                const banlistResult = await banlistResponse.json();
                currentBanlistCards = banlistResult.data || [];
            }
        } catch (e) {
            console.warn("Failed to fetch banlist:", e);
        }

        if (onProgress) {
            onProgress(Math.round((++currentStep / totalSteps) * 100), "Fetching staple cards...");
        }

        // Fetch staple cards
        let staples = [];
        try {
            const staplesResponse = await fetch(`${DB_API_BASE}/api/v7/cardinfo.php?staple=yes`);
            if (staplesResponse.ok) {
                const staplesResult = await staplesResponse.json();
                staples = staplesResult.data || [];
            }
        } catch (e) {
            console.warn("Failed to fetch staples:", e);
        }

        // Convert cardCounts to sorted array, filtering out current banlist cards
        const banlistIds = new Set(currentBanlistCards.map(c => c.id));
        const stapleIds = new Set(staples.map(s => s.id));

        let sortedCardCounts = Object.entries(cardCounts)
            .map(([key, value]) => ({ id: parseInt(key, 10), count: value }))
            .filter(cc => !banlistIds.has(cc.id))
            .sort((a, b) => b.count - a.count);

        // Separate staples from non-staples
        const staplesInParsedData = sortedCardCounts.filter(scc => stapleIds.has(scc.id));
        sortedCardCounts = sortedCardCounts.filter(scc => !stapleIds.has(scc.id));

        if (sortedCardCounts.length === 0) {
            return [];
        }

        if (onProgress) {
            onProgress(Math.round((++currentStep / totalSteps) * 100), "Fetching card details...");
        }

        // Fetch card info for non-staples and staples
        const nonStaplesCardInfo = await getCardInfo(sortedCardCounts);
        const staplesCardInfo = await getCardInfo(staplesInParsedData);

        // Calculate power levels for non-staples
        const maxValue = sortedCardCounts[0].count;
        const result = [];

        for (const { id, count } of sortedCardCounts) {
            const powerlevel = Math.min(100, Math.floor(count / maxValue * 100));
            const cardInfo = nonStaplesCardInfo.find(ci => ci.id === id);
            const cardName = cardInfo ? cardInfo.name : "Unknown card";
            const status = getStatusBasedOnPowerLevel(powerlevel);
            if (status !== "UNLIMITED") {
                result.push({
                    id: id,
                    name: cardName,
                    count: count,
                    power: powerlevel,
                    status: status,
                    imageUrl: getCardImageUrl(id)
                });
            }
        }

        // Calculate power levels for staples (rated differently)
        if (staplesInParsedData.length > 0) {
            const staplesMaxValue = staplesInParsedData[0].count;
            for (const { id, count } of staplesInParsedData) {
                const powerlevel = Math.min(100, Math.floor(count / staplesMaxValue * 100));
                const cardInfo = staplesCardInfo.find(ci => ci.id === id);
                const cardName = cardInfo ? cardInfo.name : "Unknown card";
                const status = getStapleStatusBasedOnPowerLevel(powerlevel);
                if (status !== "UNLIMITED") {
                    result.push({
                        id: id,
                        name: cardName,
                        count: count,
                        power: powerlevel,
                        status: status + "*",
                        imageUrl: getCardImageUrl(id)
                    });
                }
            }
        }

        // Deduplicate by name (keep highest count), then sort by status then name
        const grouped = {};
        for (const item of result) {
            if (!grouped[item.name] || item.count > grouped[item.name].count) {
                grouped[item.name] = item;
            }
        }

        const statusOrder = { "BANNED": 0, "BANNED*": 1, "LIMITED": 2, "LIMITED*": 3, "SEMI-LIMITED": 4, "SEMI-LIMITED*": 5 };
        return Object.values(grouped).sort((a, b) => {
            const statusDiff = (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99);
            if (statusDiff !== 0) return statusDiff;
            return a.name.localeCompare(b.name);
        });
    }

    return {
        getCardPowerFromPastYear,
        getCardImageUrl
    };
})();
