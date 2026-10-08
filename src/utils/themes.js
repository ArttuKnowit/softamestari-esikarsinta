// Themes backed by tags that are widely mapped in OSM. Unnamed objects are only used where allowUnnamed is set.
export const THEMES = {
  culture: {
    label: "Kulttuuri",
    tags: {
      tourism: ["museum", "gallery", "artwork", "attraction"],
      amenity: ["theatre", "library", "arts_centre", "cinema"],
    },
  },
  history: {
    label: "Historia",
    tags: {
      historic: ["monument", "memorial", "castle", "ruins", "archaeological_site", "fort", "manor", "wayside_cross"],
    },
  },
  nature: {
    label: "Luonto",
    tags: {
      leisure: ["park", "garden", "nature_reserve"],
      tourism: ["viewpoint"],
      natural: ["peak", "beach", "spring"],
    },
  },
  active: {
    label: "Liikunta ja leikki",
    allowUnnamed: true,
    tags: {
      leisure: ["playground", "fitness_station", "pitch", "sports_centre", "dog_park"],
    },
  },
  food: {
    label: "Ruoka",
    tags: {
      amenity: ["restaurant", "fast_food", "ice_cream", "marketplace", "food_court"],
      shop: ["bakery", "deli", "confectionery", "pastry"],
    },
  },
  cafes: {
    label: "Kahvilat",
    tags: {
      amenity: ["cafe"],
      shop: ["coffee", "tea"],
    },
  },
  civic: {
    label: "Yleinen hyöty",
    allowUnnamed: true,
    tags: {
      amenity: ["drinking_water", "recycling", "fountain"],
    },
  },
};

const FALLBACK_NAMES = {
  "amenity=drinking_water": "juomavesipiste",
  "amenity=recycling": "kierrätyspiste",
  "amenity=fountain": "suihkulähde",
  "leisure=playground": "leikkipaikka",
  "leisure=fitness_station": "kuntoilupaikka",
  "leisure=pitch": "urheilukenttä",
  "leisure=sports_centre": "urheilukeskus",
  "leisure=dog_park": "koirapuisto",
};

export function fallbackName(tags) {
  for (const [key, value] of Object.entries(tags)) {
    const name = FALLBACK_NAMES[`${key}=${value}`];
    if (name) return name;
  }
  return null;
}

// One exact key=value selector per tag: cheaper for Overpass than regex or "any value" matches.
export function overpassSelectors(themes) {
  const selectors = new Set();
  for (const theme of themes) {
    const { tags = {}, allowUnnamed = false } = THEMES[theme] ?? {};
    for (const [key, values] of Object.entries(tags)) {
      for (const value of values) {
        selectors.add(`["${key}"="${value}"]${allowUnnamed ? "" : '["name"]'}`);
      }
    }
  }
  return [...selectors];
}

export function themesOfTags(tags, allowed = Object.keys(THEMES)) {
  return allowed.filter((theme) =>
    Object.entries(THEMES[theme]?.tags ?? {}).some(([key, values]) => values.includes(tags[key]))
  );
}
