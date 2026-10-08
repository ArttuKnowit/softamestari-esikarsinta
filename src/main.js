import "./style.css";
import { renderLocationStep } from "./steps/locationStep.js";
import { renderTargetStep } from "./steps/targetStep.js";
import { renderPreferencesStep } from "./steps/preferencesStep.js";

const steps = [
  { id: "step-location", render: renderLocationStep },
  { id: "step-target", render: renderTargetStep },
  { id: "step-preferences", render: renderPreferencesStep },
];

const state = {};
const stepValid = steps.map(() => false);
let currentStep = 0;
let cleanup = null;

const track = document.querySelector(".carousel-track");
const prevButton = document.querySelector("#btn-prev");
const nextButton = document.querySelector("#btn-next");
const dots = document.querySelectorAll(".dot");

function renderCurrentStep() {
  if (cleanup) cleanup();
  const step = steps[currentStep];
  const index = currentStep;
  cleanup =
    step.render(document.getElementById(step.id), state, {
      onChange: (isValid) => {
        stepValid[index] = isValid;
        updateNav();
      },
    }) ?? null;
}

function updateNav() {
  track.style.transform = `translateX(-${currentStep * (100 / steps.length)}%)`;
  prevButton.disabled = currentStep === 0;
  nextButton.disabled = !stepValid[currentStep];
  nextButton.textContent = currentStep === steps.length - 1 ? "Valmis" : "Seuraava";
  dots.forEach((dot, index) => dot.classList.toggle("active", index === currentStep));
}

function goTo(index) {
  currentStep = index;
  renderCurrentStep();
  updateNav();
}

prevButton.addEventListener("click", () => {
  if (currentStep > 0) goTo(currentStep - 1);
});

nextButton.addEventListener("click", () => {
  if (currentStep === steps.length - 1) {
    console.log("Valinnat valmiit:", state);
    return;
  }
  goTo(currentStep + 1);
});

goTo(0);
