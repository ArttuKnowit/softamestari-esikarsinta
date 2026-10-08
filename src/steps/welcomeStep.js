// Step 0: introduction; nothing to fill in, so it is always valid.
export function renderWelcomeStep(container, state, { onChange }) {
  container.innerHTML = `
    <h1>Tervetuloa!</h2>
    <div class="welcome-text">
        <p>The Road Less Traveled on verkkosovellus, joka johdattaa sinut pienelle tutkimusretkelle lähiympäristössäsi. Tarkoituksena on antaa käyttäjälle matalan kynnyksen keino tutustua lähiympäristöön tai löytää uusia asioita tuttujenkin reittien varrelta.</p>
        <p>Sinulle valikoitunut reitti ei ole aina kaikista nopein, mutta se tarjoaa matkalle jotain opittavaa tai tehtävää - parhaimmillaan uuden seikkailun!</p>
        <p>Aloita painamalla "Seuraava".</p>
    </div>
  `;

  onChange(true);
}
