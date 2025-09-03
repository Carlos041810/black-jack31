const SUITS = {
    clubs: '♣',
    diamonds: '♦',
    hearts: '♥',
    spades: '♠',
};

const VALUES = { 
    '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, 
    '8': 8, '9': 9, '10': 10, 
    'J': 10, 'Q': 10, 'K': 10, 'A': 11 
};

const SRC_SUITS = { 
    clubs: 'Clubs', 
    diamonds: 'Diamond', 
    hearts: 'Hearts', 
    spades: 'Spades' 
};

const SRC_VALUES = { 
    '2': '2', '3': '3', '4': '4', '5': '5', 
    '6': '6', '7': '7', '8': '8', '9': '9', '10': '10', 
    'J': 'Jack', 'Q': 'Queen', 'K': 'King', 'A': 'Ace' 
};

function createDeck() {
    const deck = [];
    for (const suitKey in SUITS) {
        for (const valueKey in VALUES) {
            deck.push({
                suit: SUITS[suitKey],       
                value: valueKey,            
                points: VALUES[valueKey],   
                src: `img/${SRC_SUITS[suitKey]}-${SRC_VALUES[valueKey]}.png` 
            });
        }
    }
    return deck;
}

function shuffleDeck(deck) {
    // Algoritmo Fisher-Yates para barajar
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

// Exportar para Node.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createDeck, shuffleDeck };
}
