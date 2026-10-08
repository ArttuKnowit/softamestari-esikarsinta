const THEMES = [
  { key: "culture", label: "Kulttuuri" },
  { key: "nature", label: "Luonto" },
  { key: "food", label: "Ruoka" },
  { key: "cafes", label: "Kahvilat" },
];

const BUDGET_RANGE = { min: 0, max: 200, step: 5 };

// Step 3: budget and interests; valid once at least one interest is selected.
export function renderPreferencesStep(container, state, { onChange }) {
  if (state.budget === undefined) state.budget = 50;
  if (!state.themes) state.themes = [];

  container.innerHTML = `
    <h2>Budjetti ja kiinnostuksen kohteet</h2>
    <div class="field-group">
      <label for="budget-range">
        Budjetti
        <output id="budget-output">${state.budget} €</output>
      </label>
      <input
        id="budget-range"
        type="range"
        min="${BUDGET_RANGE.min}"
        max="${BUDGET_RANGE.max}"
        step="${BUDGET_RANGE.step}"
        value="${state.budget}"
      />
    </div>
    <h3>Mikä kiinnostaa?</h3>
    <div class="theme-options">
      ${THEMES.map(
        ({ key, label }) => `
        <button type="button" class="theme-option" data-theme="${key}" aria-pressed="false">
          ${label}
        </button>
      `
      ).join("")}
    </div>
  `;

  const budgetInput = container.querySelector("#budget-range");
  const budgetOutput = container.querySelector("#budget-output");
  const buttons = container.querySelectorAll(".theme-option");

  function refresh() {
    buttons.forEach((button) => {
      const selected = state.themes.includes(button.dataset.theme);
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    onChange(state.themes.length > 0);
  }

  budgetInput.addEventListener("input", () => {
    state.budget = Number(budgetInput.value);
    budgetOutput.textContent = `${state.budget} €`;
  });

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.theme;
      state.themes = state.themes.includes(key)
        ? state.themes.filter((theme) => theme !== key)
        : [...state.themes, key];
      refresh();
    });
  });

  refresh();
}
