import { describe, it, expect } from 'vitest'
import { parseMetadata, buildGameMeta, decodeXml } from '../src/main/launchbox-parse'

const XML = `<?xml version="1.0" standalone="yes"?>
<LaunchBox>
  <Game>
    <Name>Abe&apos;s Oddysee</Name>
    <ReleaseDate>1997-09-19T02:00:00+02:00</ReleaseDate>
    <Overview>First line of the summary.
Second line &amp; more.

Last line.</Overview>
    <MaxPlayers>1</MaxPlayers>
    <DatabaseID>42</DatabaseID>
    <Platform>Sony Playstation</Platform>
    <CommunityRating>4.1666666</CommunityRating>
    <CommunityRatingCount>12</CommunityRatingCount>
    <Genres>Platform;Puzzle</Genres>
    <Developer>Oddworld Inhabitants</Developer>
    <Publisher>GT Interactive</Publisher>
  </Game>
  <Game>
    <Name>Some PC Game</Name>
    <DatabaseID>43</DatabaseID>
    <Platform>Windows</Platform>
  </Game>
  <GameAlternateName>
    <AlternateName>L'Odyssée d'Abe</AlternateName>
    <DatabaseID>42</DatabaseID>
    <Region>France</Region>
  </GameAlternateName>
  <GameImage>
    <DatabaseID>42</DatabaseID>
    <FileName>abc.jpg</FileName>
    <Type>Box - Back</Type>
    <Region>Europe</Region>
  </GameImage>
  <GameImage>
    <DatabaseID>42</DatabaseID>
    <FileName>ignored.jpg</FileName>
    <Type>Screenshot - Gameplay</Type>
  </GameImage>
</LaunchBox>
`

// Découpe le texte (fins de ligne Windows) en petits morceaux d'octets, y compris au
// milieu d'un caractère accentué, comme la lecture en flux de l'archive.
async function* chunks(text, size = 7) {
  const bytes = Buffer.from(text.replace(/\n/g, '\r\n'), 'utf8')
  for (let i = 0; i < bytes.length; i += size) yield bytes.subarray(i, i + size)
}

describe('launchbox-parse', () => {
  it('décode les entités XML', () => {
    expect(decodeXml('Tom &amp; Jerry &#233;t&#xE9; &apos;')).toBe("Tom & Jerry été '")
  })

  it('lit les jeux des plateformes voulues avec leur fiche, même sur plusieurs lignes', async () => {
    const { games, altNames, images } = await parseMetadata(chunks(XML), ['Sony Playstation'])
    expect([...games.keys()]).toEqual(['42'])
    const game = games.get('42')
    expect(game.name).toBe("Abe's Oddysee")
    expect(game.platform).toBe('Sony Playstation')
    expect(game.meta).toEqual({
      overview: 'First line of the summary.\nSecond line & more.\n\nLast line.',
      genres: ['Platform', 'Puzzle'],
      developer: 'Oddworld Inhabitants',
      publisher: 'GT Interactive',
      maxPlayers: 1,
      releaseDate: '1997-09-19',
      rating: 4.2,
      ratingCount: 12
    })
    expect(altNames.get('42')).toEqual(["L'Odyssée d'Abe"])
    expect(images.get('42')).toEqual({ back: [['abc.jpg', 'Europe']] })
  })

  it('omet les champs vides et tronque les résumés trop longs', () => {
    expect(buildGameMeta({ Genres: ' ; ', MaxPlayers: '0', CommunityRating: '3' })).toEqual({})
    const meta = buildGameMeta({
      Overview: 'x'.repeat(5000),
      ReleaseYear: '1999',
      Cooperative: 'true'
    })
    expect(meta.overview.length).toBeLessThan(4010)
    expect(meta.overview.endsWith('…')).toBe(true)
    expect(meta.releaseDate).toBe('1999')
    expect(meta.cooperative).toBe(true)
  })
})
