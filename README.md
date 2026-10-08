# The Road Less Traveled

The Road Less Traveled on interaktiivinen verkkosovellus, joka johdattaa käyttäjänsä pienelle seikkailulle lähipiirissä. Sovelluksen tarkoituksena on antaa käyttäjälle matalan kynnyksen keino tutustua lähiympäristöön paremmin, ja kokea myös omassa naapurustossaan kohteita joita ei ole aiemmin käynyt katsomassa. Tavoitteena on saada käyttäjät liikkeelle.

Sovellus tarjoaa kaksi eri vaihtoehtoa: siirtymä pisteestä A pisteeseen B, tai lenkki jossa palataan takaisin lähtöpaikkaan. Siirtymässä sovellus luo käyttäjälle reitin, joka ei välttämättä ole lyhin mahdollinen reitti kahden pisteen välillä, mutta joka sisältää jonkinnäköisiä rasteja reitin varrella, jotka liittyvät kiinnostaviin kohteisiin (Points of Interest) reitin varrella. Lenkissä sovellus taas kysyy käyttäjältä valitun reitin pituutta, ja tarjoaa käyttäjälle lenkin, jonka varrella on samalla tavalla rasteja. Rasteilla käyttäjä suorittaa pienen leikkimielisen, tutkimuksellisen tai yleishyödyllisen tehtävän.

## Asennusohjeet

Sovellus vaatii toimiakseen ympäristön, jossa toimii Noden moderni versio. Asentaaksesi riippuvuudet, aja käsky

```
npm install
```

ja sen jälkeen käynnistääksesi sovellus, suorita

```
npm start
```

Sovellus aukeaa sen jälkeen osoitteeseen http://localhost:5173/

## Käyttöohjeet

Avaa sovellus ja valitse itsellesi seuraavista kategorioista niin monta **teemaa** kuin seikkailullesi haluat:

- Luonto
- Kulttuuri
- Ruoka
- Yleinen hyöty

Valitse sen jälkeen käytettävissä oleva aika, sekä mahdollinen budjetti (oletuksena 0€).

Sovellus luo sinulle reitin, johon kuuluu muutamia rasteja. V

### Tekniikka ja rastit

Sovellus toimii kokonaan selaimessa. Karttapohjana on OpenStreetMap (Leaflet). Kohteet ja kävelyverkko haetaan Overpass API:sta, ja reitit lasketaan selaimessa omalla A*-reitityksellä (`src/utils/graph.js`, `src/utils/router.js`). Overpass on julkinen palvelu, joten reitin luominen voi kestää hetken.

Reitti kulkee vähintään kahden rastin verran jokaista kilometriä kohden. Siirtymässä reitti on 10–25 % lyhintä reittiä pidempi.

Rastitehtäviä voi muokata tiedostossa `src/utils/tasks.json`. Jokaisella tehtävällä on `theme` (teema), `match` (OSM-tagit, esim. `amenity=cafe`, tai `*` kaikille), `text` (`{name}` korvataan kohteen nimellä) ja valinnainen `cost` (euroa). Teemojen OSM-tagit löytyvät tiedostosta `src/utils/themes.js`.

Testit: `npm test`
