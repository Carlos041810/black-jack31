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

    // Cartas negativas que se añadirán 2 veces cada una
    const negativeCardsInfo = [
        { value: '-3', points: -3, src: 'img/negative-3.png' },
        { value: '-4', points: -4, src: 'img/negative-4.png' },
        { value: '-5', points: -5, src: 'img/negative-5.png' },
        { value: '-6', points: -6, src: 'img/negative-6.png' }
    ];

    for (const cardInfo of negativeCardsInfo) {
        // Añadir cada carta negativa dos veces
        for (let i = 0; i < 2; i++) {
            deck.push({ suit: '☠️', ...cardInfo }); // Usamos un palo especial para estas cartas
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
