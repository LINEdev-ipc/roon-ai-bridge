"""Representative MusicBrainz release-group inputs for cases 501 onward."""

from __future__ import annotations

from typing import TypedDict


class RepresentativeSpec(TypedDict):
    category: str
    album: str
    artist: str
    cohort: str
    language: str
    era: str


def spec(
    category: str,
    album: str,
    artist: str,
    cohort: str,
    language: str,
    era: str,
) -> RepresentativeSpec:
    return {
        "category": category,
        "album": album,
        "artist": artist,
        "cohort": cohort,
        "language": language,
        "era": era,
    }


REPRESENTATIVE_SPECS: list[RepresentativeSpec] = [
    # Rock, alternative and punk across several decades.
    spec("default", "The Queen Is Dead", "The Smiths", "rock_alternative", "en", "1980s"),
    spec("default", "Disintegration", "The Cure", "rock_alternative", "en", "1980s"),
    spec("default", "Loveless", "My Bloody Valentine", "rock_alternative", "en", "1990s"),
    spec("default", "Ten", "Pearl Jam", "rock_alternative", "en", "1990s"),
    spec("default", "Siamese Dream", "The Smashing Pumpkins", "rock_alternative", "en", "1990s"),
    spec("default", "Is This It", "The Strokes", "rock_alternative", "en", "2000s"),
    spec("default", "Elephant", "The White Stripes", "rock_alternative", "en", "2000s"),
    spec("default", "Funeral", "Arcade Fire", "rock_alternative", "en", "2000s"),
    spec("default", "Whatever People Say I Am, That's What I'm Not", "Arctic Monkeys", "rock_alternative", "en", "2000s"),
    spec("default", "Currents", "Tame Impala", "rock_alternative", "en", "2010s"),
    spec("default", "Punisher", "Phoebe Bridgers", "rock_alternative", "en", "2020s"),
    spec("default", "Blue Weekend", "Wolf Alice", "rock_alternative", "en", "2020s"),

    # Pop, R&B and vocal records.
    spec("default", "Ray of Light", "Madonna", "pop_rnb", "en", "1990s"),
    spec("default", "The Velvet Rope", "Janet Jackson", "pop_rnb", "en", "1990s"),
    spec("default", "Songs in A Minor", "Alicia Keys", "pop_rnb", "en", "2000s"),
    spec("default", "Confessions", "Usher", "pop_rnb", "en", "2000s"),
    spec("default", "Channel Orange", "Frank Ocean", "pop_rnb", "en", "2010s"),
    spec("default", "Ctrl", "SZA", "pop_rnb", "en", "2010s"),
    spec("default", "1989", "Taylor Swift", "pop_rnb", "en", "2010s"),
    spec("default", "Melodrama", "Lorde", "pop_rnb", "en", "2010s"),
    spec("default", "When We All Fall Asleep, Where Do We Go?", "Billie Eilish", "pop_rnb", "en", "2010s"),
    spec("default", "Future Nostalgia", "Dua Lipa", "pop_rnb", "en", "2020s"),
    spec("default", "Renaissance", "Beyoncé", "pop_rnb", "en", "2020s"),
    spec("default", "SOS", "SZA", "pop_rnb", "en", "2020s"),

    # Hip-hop with different regions and eras.
    spec("default", "The Chronic", "Dr. Dre", "hiphop", "en", "1990s"),
    spec("default", "Enter the Wu-Tang (36 Chambers)", "Wu-Tang Clan", "hiphop", "en", "1990s"),
    spec("default", "Ready to Die", "The Notorious B.I.G.", "hiphop", "en", "1990s"),
    spec("default", "Aquemini", "OutKast", "hiphop", "en", "1990s"),
    spec("default", "Madvillainy", "Madvillain", "hiphop", "en", "2000s"),
    spec("default", "Stankonia", "OutKast", "hiphop", "en", "2000s"),
    spec("default", "good kid, m.A.A.d city", "Kendrick Lamar", "hiphop", "en", "2010s"),
    spec("default", "2014 Forest Hills Drive", "J. Cole", "hiphop", "en", "2010s"),
    spec("default", "Sometimes I Might Be Introvert", "Little Simz", "hiphop", "en", "2020s"),
    spec("default", "Cheat Codes", "Danger Mouse & Black Thought", "hiphop", "en", "2020s"),

    # Electronic, ambient, dance and trip-hop.
    spec("default", "Selected Ambient Works 85–92", "Aphex Twin", "electronic", "instrumental", "1990s"),
    spec("default", "Music Has the Right to Children", "Boards of Canada", "electronic", "instrumental", "1990s"),
    spec("default", "Mezzanine", "Massive Attack", "electronic", "en", "1990s"),
    spec("default", "Play", "Moby", "electronic", "en", "1990s"),
    spec("default", "Since I Left You", "The Avalanches", "electronic", "en", "2000s"),
    spec("default", "Untrue", "Burial", "electronic", "instrumental", "2000s"),
    spec("default", "Cross", "Justice", "electronic", "instrumental", "2000s"),
    spec("default", "Settle", "Disclosure", "electronic", "en", "2010s"),
    spec("default", "In Colour", "Jamie xx", "electronic", "en", "2010s"),
    spec("default", "Immunity", "Jon Hopkins", "electronic", "instrumental", "2010s"),

    # Jazz and blues.
    spec("default", "A Love Supreme", "John Coltrane", "jazz_blues", "instrumental", "1960s"),
    spec("default", "Time Out", "The Dave Brubeck Quartet", "jazz_blues", "instrumental", "1950s"),
    spec("default", "Mingus Ah Um", "Charles Mingus", "jazz_blues", "instrumental", "1950s"),
    spec("default", "Head Hunters", "Herbie Hancock", "jazz_blues", "instrumental", "1970s"),
    spec("default", "The Black Saint and the Sinner Lady", "Charles Mingus", "jazz_blues", "instrumental", "1960s"),
    spec("default", "Ella and Louis", "Ella Fitzgerald & Louis Armstrong", "jazz_blues", "en", "1950s"),
    spec("default", "Getz/Gilberto", "Stan Getz & João Gilberto", "jazz_blues", "pt", "1960s"),
    spec("default", "Journey in Satchidananda", "Alice Coltrane", "jazz_blues", "instrumental", "1970s"),
    spec("default", "Chet Baker Sings", "Chet Baker", "jazz_blues", "en", "1950s"),
    spec("default", "Moanin' in the Moonlight", "Howlin’ Wolf", "jazz_blues", "en", "1950s"),
    spec("default", "Hoodoo Man Blues", "Junior Wells' Chicago Blues Band", "jazz_blues", "en", "1960s"),
    spec("default", "Texas Flood", "Stevie Ray Vaughan and Double Trouble", "jazz_blues", "en", "1980s"),

    # Soul, funk, disco and reggae.
    spec("default", "I Never Loved a Man the Way I Love You", "Aretha Franklin", "soul_funk_reggae", "en", "1960s"),
    spec("default", "Lady Soul", "Aretha Franklin", "soul_funk_reggae", "en", "1960s"),
    spec("default", "Super Fly", "Curtis Mayfield", "soul_funk_reggae", "en", "1970s"),
    spec("default", "Innervisions", "Stevie Wonder", "soul_funk_reggae", "en", "1970s"),
    spec("default", "Maggot Brain", "Funkadelic", "soul_funk_reggae", "en", "1970s"),
    spec("default", "Mothership Connection", "Parliament", "soul_funk_reggae", "en", "1970s"),
    spec("default", "Exodus", "Bob Marley & The Wailers", "soul_funk_reggae", "en", "1970s"),
    spec("default", "Voodoo", "D’Angelo", "soul_funk_reggae", "en", "2000s"),
    spec("default", "Mama's Gun", "Erykah Badu", "soul_funk_reggae", "en", "2000s"),
    spec("default", "Black Messiah", "D’Angelo and The Vanguard", "soul_funk_reggae", "en", "2010s"),

    # Country, folk and singer-songwriters.
    spec("default", "Jolene", "Dolly Parton", "country_folk", "en", "1970s"),
    spec("default", "Red Headed Stranger", "Willie Nelson", "country_folk", "en", "1970s"),
    spec("default", "Coat of Many Colors", "Dolly Parton", "country_folk", "en", "1970s"),
    spec("default", "Pink Moon", "Nick Drake", "country_folk", "en", "1970s"),
    spec("default", "Car Wheels on a Gravel Road", "Lucinda Williams", "country_folk", "en", "1990s"),
    spec("default", "For Emma, Forever Ago", "Bon Iver", "country_folk", "en", "2000s"),
    spec("default", "Southeastern", "Jason Isbell", "country_folk", "en", "2010s"),
    spec("default", "Golden Hour", "Kacey Musgraves", "country_folk", "en", "2010s"),
    spec("default", "Carrie & Lowell", "Sufjan Stevens", "country_folk", "en", "2010s"),
    spec("default", "Saint Cloud", "Waxahatchee", "country_folk", "en", "2020s"),

    # Spanish-language and Latin American catalog.
    spec("default", "Siembra", "Willie Colón & Rubén Blades", "latin", "es", "1970s"),
    spec("default", "Artaud", "Pescado Rabioso", "latin", "es", "1970s"),
    spec("default", "Clics modernos", "Charly García", "latin", "es", "1980s"),
    spec("default", "¿Dónde están los ladrones?", "Shakira", "latin", "es", "1990s"),
    spec("default", "El amor después del amor", "Fito Páez", "latin", "es", "1990s"),
    spec("default", "Sueños líquidos", "Maná", "latin", "es", "1990s"),
    spec("default", "Barrio fino", "Daddy Yankee", "latin", "es", "2000s"),
    spec("default", "Ahí vamos", "Gustavo Cerati", "latin", "es", "2000s"),
    spec("default", "Residente o visitante", "Calle 13", "latin", "es", "2000s"),
    spec("default", "Hasta la raíz", "Natalia Lafourcade", "latin", "es", "2010s"),
    spec("default", "Vibras", "J Balvin", "latin", "es", "2010s"),
    spec("default", "X 100PRE", "Bad Bunny", "latin", "es", "2010s"),
    spec("default", "YHLQMDLG", "Bad Bunny", "latin", "es", "2020s"),
    spec("default", "DeBÍ TiRAR MáS FOToS", "Bad Bunny", "latin", "es", "2020s"),
    spec("default", "Mañana será bonito", "KAROL G", "latin", "es", "2020s"),

    # Portuguese, African, Asian and continental European records.
    spec("default", "Clube da Esquina", "Milton Nascimento & Lô Borges", "world_nonenglish", "pt", "1970s"),
    spec("default", "Construção", "Chico Buarque", "world_nonenglish", "pt", "1970s"),
    spec("default", "Acabou chorare", "Novos Baianos", "world_nonenglish", "pt", "1970s"),
    spec("default", "África Brasil", "Jorge Ben", "world_nonenglish", "pt", "1970s"),
    spec("default", "Expensive Shit", "Fela Kuti & Africa 70", "world_nonenglish", "yo", "1970s"),
    spec("default", "Buena Vista Social Club", "Buena Vista Social Club", "world_nonenglish", "es", "1990s"),
    spec("default", "Miss Perfumado", "Cesária Évora", "world_nonenglish", "pt", "1980s"),
    spec("default", "Talking Timbuktu", "Ali Farka Touré with Ry Cooder", "world_nonenglish", "multi", "1990s"),
    spec("default", "Logozo", "Angélique Kidjo", "world_nonenglish", "multi", "1990s"),
    spec("default", "Thousand Knives of", "Ryuichi Sakamoto", "world_nonenglish", "instrumental", "1970s"),
    spec("default", "Yellow Magic Orchestra", "Yellow Magic Orchestra", "world_nonenglish", "ja", "1970s"),
    spec("default", "First Love", "Hikaru Utada", "world_nonenglish", "ja", "1990s"),
    spec("default", "Palette", "IU", "world_nonenglish", "ko", "2010s"),
    spec("default", "Racine carrée", "Stromae", "world_nonenglish", "fr", "2010s"),
    spec("default", "Histoire de Melody Nelson", "Serge Gainsbourg", "world_nonenglish", "fr", "1970s"),

    # Metal and heavier music.
    spec("default", "The Number of the Beast", "Iron Maiden", "metal", "en", "1980s"),
    spec("default", "Reign in Blood", "Slayer", "metal", "en", "1980s"),
    spec("default", "Rust in Peace", "Megadeth", "metal", "en", "1990s"),
    spec("default", "Blackwater Park", "Opeth", "metal", "en", "2000s"),
    spec("default", "White Pony", "Deftones", "metal", "en", "2000s"),
    spec("default", "Toxicity", "System of a Down", "metal", "en", "2000s"),
    spec("default", "From Mars to Sirius", "Gojira", "metal", "en", "2000s"),
    spec("default", "Leviathan", "Mastodon", "metal", "en", "2000s"),
    spec("default", "Sunbather", "Deafheaven", "metal", "en", "2010s"),
    spec("default", "Infest the Rats' Nest", "King Gizzard & The Lizard Wizard", "metal", "en", "2010s"),

    # Classical reference recordings and film/game scores.
    spec("default", "Goldberg Variations", "Glenn Gould", "classical_soundtrack", "instrumental", "1950s"),
    spec("default", "Vivaldi: The Four Seasons", "Itzhak Perlman", "classical_soundtrack", "instrumental", "1970s"),
    spec("default", "Beethoven: Symphonies Nos. 5 & 7", "Carlos Kleiber", "classical_soundtrack", "instrumental", "1970s"),
    spec("default", "The Planets", "Herbert von Karajan", "classical_soundtrack", "instrumental", "1980s"),
    spec("default", "Star Wars", "John Williams", "classical_soundtrack", "instrumental", "1970s"),
    spec("default", "Blade Runner", "Vangelis", "classical_soundtrack", "instrumental", "1990s"),
    spec("default", "Spirited Away", "Joe Hisaishi", "classical_soundtrack", "instrumental", "2000s"),
    spec("default", "The Social Network", "Trent Reznor and Atticus Ross", "classical_soundtrack", "instrumental", "2010s"),
    spec("default", "Interstellar", "Hans Zimmer", "classical_soundtrack", "instrumental", "2010s"),
    spec("default", "Journey", "Austin Wintory", "classical_soundtrack", "instrumental", "2010s"),

    # Live recordings: rock, soul, jazz, electronic, country and pop.
    spec("live", "Live at the Regal", "B.B. King", "live", "en", "1960s"),
    spec("live", "Live at the Harlem Square Club, 1963", "Sam Cooke", "live", "en", "1960s"),
    spec("live", "At Fillmore East", "The Allman Brothers Band", "live", "en", "1970s"),
    spec("live", "The Last Waltz", "The Band", "live", "en", "1970s"),
    spec("live", "Cheap Trick at Budokan", "Cheap Trick", "live", "en", "1970s"),
    spec("live", "Live Rust", "Neil Young & Crazy Horse", "live", "en", "1970s"),
    spec("live", "Sunday at the Village Vanguard", "Bill Evans Trio", "live", "instrumental", "1960s"),
    spec("live", "The Köln Concert", "Keith Jarrett", "live", "instrumental", "1970s"),
    spec("live", "Queen Rock Montreal", "Queen", "live", "en", "1980s"),
    spec("live", "Roseland NYC Live", "Portishead", "live", "en", "1990s"),
    spec("live", "Alive 2007", "Daft Punk", "live", "instrumental", "2000s"),
    spec("live", "Live in London", "Leonard Cohen", "live", "en", "2000s"),
    spec("live", "Live from Austin, TX", "Townes Van Zandt", "live", "en", "2000s"),
    spec("live", "Live at the Royal Albert Hall", "Adele", "live", "en", "2010s"),
    spec("live", "Homecoming: The Live Album", "Beyoncé", "live", "en", "2010s"),
    spec("live", "Live at River Plate", "AC/DC", "live", "en", "2010s"),
    spec("live", "El último concierto", "Soda Stereo", "live", "es", "1990s"),
    spec("live", "11 episodios sinfónicos", "Gustavo Cerati", "live", "es", "2000s"),

    # Remix and dub projects with explicit mixes, edits and contextual tracks.
    spec("remix", "Telegram", "Björk", "remix", "en", "1990s"),
    spec("remix", "Mixed Up", "The Cure", "remix", "en", "1990s"),
    spec("remix", "Non-Stop Ecstatic Dancing", "Soft Cell", "remix", "en", "1980s"),
    spec("remix", "No Protection", "Massive Attack v Mad Professor", "remix", "en", "1990s"),
    spec("remix", "Echo Dek", "Primal Scream", "remix", "en", "1990s"),
    spec("remix", "The Rest of New Order", "New Order", "remix", "en", "1990s"),
    spec("remix", "Remixed & Revisited", "Madonna", "remix", "en", "2000s"),
    spec("remix", "The Remixes", "Mariah Carey", "remix", "en", "2000s"),
    spec("remix", "Laika Come Home", "Spacemonkeyz versus Gorillaz", "remix", "en", "2000s"),
    spec("remix", "TRON: Legacy Reconfigured", "Daft Punk", "remix", "instrumental", "2010s"),
    spec("remix", "TKOL RMX 1234567", "Radiohead", "remix", "en", "2010s"),
    spec("remix", "Bastards", "Björk", "remix", "en", "2010s"),
    spec("remix", "Re:Generations", "The Cinematic Orchestra", "remix", "instrumental", "2010s"),
    spec("remix", "Dawn of Chromatica", "Lady Gaga", "remix", "en", "2020s"),
    spec("remix", "Club Future Nostalgia", "Dua Lipa", "remix", "en", "2020s"),
    spec("remix", "1000 gecs and the Tree of Clues", "100 gecs", "remix", "en", "2020s"),
    spec("remix", "Versions", "Thievery Corporation", "remix", "multi", "2000s"),
    spec("remix", "American Life Mixshow Mix", "Madonna", "remix", "en", "2020s"),

    # Albums intentionally made of covers.
    spec("cover", "Strange Little Girls", "Tori Amos", "cover", "en", "2000s"),
    spec("cover", "Acid Eaters", "Ramones", "cover", "en", "1990s"),
    spec("cover", "The Covers Record", "Cat Power", "cover", "en", "2000s"),
    spec("cover", "Twelve", "Patti Smith", "cover", "en", "2000s"),
    spec("cover", "Other People's Songs", "Erasure", "cover", "en", "2000s"),
    spec("cover", "Rock 'n' Roll", "John Lennon", "cover", "en", "1970s"),
    spec("cover", "Blue & Lonesome", "The Rolling Stones", "cover", "en", "2010s"),
    spec("cover", "Kicking Against the Pricks", "Nick Cave and the Bad Seeds", "cover", "en", "1980s"),
    spec("cover", "We Shall Overcome: The Seeger Sessions", "Bruce Springsteen", "cover", "en", "2000s"),

    # Acoustic and unplugged releases.
    spec("acoustic", "Unplugged", "Alice in Chains", "acoustic", "en", "1990s"),
    spec("acoustic", "Unplugged", "Eric Clapton", "acoustic", "en", "1990s"),
    spec("acoustic", "MTV Unplugged No. 2.0", "Lauryn Hill", "acoustic", "en", "2000s"),
    spec("acoustic", "MTV Unplugged", "Shakira", "acoustic", "es", "1990s"),
    spec("acoustic", "Música de fondo: MTV Unplugged", "Zoé", "acoustic", "es", "2010s"),
    spec("acoustic", "Acústico MTV", "Soda Stereo", "acoustic", "es", "1990s"),
    spec("acoustic", "Acústico MTV", "Legião Urbana", "acoustic", "pt", "1990s"),
    spec("acoustic", "Acústico MTV", "Titãs", "acoustic", "pt", "1990s"),
    spec("acoustic", "Acústico MTV", "Rita Lee", "acoustic", "pt", "1990s"),
    spec("acoustic", "Acústico MTV", "Capital Inicial", "acoustic", "pt", "2000s"),
    spec("acoustic", "Acústico MTV", "Charlie Brown Jr.", "acoustic", "pt", "2000s"),
    spec("acoustic", "Acústico MTV", "Cássia Eller", "acoustic", "pt", "2000s"),
    spec("acoustic", "Unplugged", "Neil Young", "acoustic", "en", "1990s"),
    spec("acoustic", "MTV Unplugged", "Korn", "acoustic", "en", "2000s"),

    # Demo, session and archival collections used as alternate-version tests.
    spec("alternate", "The Smile Sessions", "The Beach Boys", "alternate", "en", "2010s"),
    spec("alternate", "The Basement Tapes Raw", "Bob Dylan", "alternate", "en", "2010s"),
    spec("alternate", "The Bootleg Series Volumes 1–3 (Rare & Unreleased) 1961–1991", "Bob Dylan", "alternate", "en", "1990s"),
    spec("alternate", "Anthology 1", "The Beatles", "alternate", "en", "1990s"),
    spec("alternate", "Anthology 2", "The Beatles", "alternate", "en", "1990s"),
    spec("alternate", "Anthology 3", "The Beatles", "alternate", "en", "1990s"),
    spec("alternate", "Piano & a Microphone 1983", "Prince", "alternate", "en", "2010s"),
    spec("alternate", "Demos", "Crosby, Stills & Nash", "alternate", "en", "2000s"),
    spec("alternate", "Home Recordings", "Tony Joe White", "alternate", "en", "2000s"),
]
