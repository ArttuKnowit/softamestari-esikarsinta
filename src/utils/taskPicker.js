const DEFAULT_TASK = {
  id: "default",
  text: "Tutustu kohteeseen {name} ja ota siitä valokuva.",
  cost: 0,
};

export function matchesTags(tags, match) {
  return match.some((entry) => {
    if (entry === "*") return true;
    const [key, value] = entry.split("=");
    return value === undefined ? tags[key] !== undefined : tags[key] === value;
  });
}

// Assigns one task per POI, preferring specific matches, rarely-used tasks and ones within budget.
// Tasks with theme "any" fit every selection and always compete with the specific ones.
export function pickTasks(pois, { tasks, themes, budget = Infinity, random = Math.random }) {
  const uses = new Map();
  let remaining = budget;

  return pois.map((poi) => {
    const eligible = tasks.filter(
      (task) =>
        (task.theme === "any" || themes.includes(task.theme)) &&
        matchesTags(poi.tags, task.match) &&
        (task.cost ?? 0) <= remaining
    );
    const specific = eligible.filter((task) => task.theme === "any" || !task.match.includes("*"));
    const pool = specific.length > 0 ? specific : eligible;

    let chosen = DEFAULT_TASK;
    if (pool.length > 0) {
      const fewest = Math.min(...pool.map((task) => uses.get(task.id) ?? 0));
      const leastUsed = pool.filter((task) => (uses.get(task.id) ?? 0) === fewest);
      chosen = leastUsed[Math.floor(random() * leastUsed.length)];
    }

    uses.set(chosen.id, (uses.get(chosen.id) ?? 0) + 1);
    remaining -= chosen.cost ?? 0;

    return {
      poi,
      task: {
        id: chosen.id,
        text: chosen.text.replaceAll("{name}", poi.name),
        cost: chosen.cost ?? 0,
      },
    };
  });
}
