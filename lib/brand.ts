// The product's name, in one place. Rename the product by changing this file (plus public/sw.js, a static script that
// cannot import it). Internal identifiers such as the storage prefix, the encryption label and the package name keep the
// old name on purpose: changing them would orphan saved data and make stored tokens undecryptable.
export const BRAND = {
  name: "Orbit",
  short: "Orbit",
  tagline: "Your engineering work in one pulse.",
} as const;
