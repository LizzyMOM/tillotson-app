import { test } from "node:test";
import assert from "node:assert/strict";
import { ageOn, isMinor, stepsFor, requiredDocuments, startRuleFor, quote, cleanLines, validateStep, readyToPay, displayName, type EventSetup, type Draft } from "../src/lib/rules.ts";
import { newPin, hashSecret, checkSecret } from "../src/lib/secrets.ts";

const ev: EventSetup = {
  startsOn: "2027-10-15", hostFederationId: "fed-es", depositCents: 30000,
  teeSizes: ["Youth (age 12)", "S", "M", "L"], seatSizes: ["XS", "S", "M"],
  categories: [
    { id: "mini", name: "T4 Mini", minAge: 7, maxAge: 12 },
    { id: "senior", name: "T4 Senior", minAge: 15, maxAge: null },
  ],
  tickets: [
    { id: "o1", name: "Option 1", priceCents: 279500, includesKart: true, categoryIds: null },
    { id: "o2", name: "Option 2", priceCents: 135000, includesKart: false, categoryIds: null },
  ],
  products: [
    { id: "tk", kind: "rental", name: "Tillotson Toolkit", priceCents: 10000, sizes: [], maxQty: 1, bundleGroup: null },
    { id: "tee", kind: "clothing", name: "Extra event T-shirt", priceCents: 2500, sizes: ["S", "M"], maxQty: 10, bundleGroup: "clothing" },
    { id: "polo", kind: "clothing", name: "Event polo", priceCents: 3500, sizes: ["S", "M"], maxQty: 10, bundleGroup: "clothing" },
    { id: "hoody", kind: "clothing", name: "Event hoody", priceCents: 4500, sizes: ["M", "L"], maxQty: 10, bundleGroup: "clothing" },
  ],
  bundles: [{ bundleGroup: "clothing", name: "T-shirt, polo and hoody", discountPct: 20 }],
  federations: [
    { id: "fed-es", name: "RFEDA", country: "Spain", startPermission: "check" },
    { id: "fed-uk", name: "Motorsport UK", country: "United Kingdom", startPermission: "on_licence" },
    { id: "fed-se", name: "SBF", country: "Sweden", startPermission: "letter" },
    { id: "fed-it", name: "ACI Sport", country: "Italy", startPermission: "check" },
  ],
};

test("age is worked out on the first day of the event", () => {
  assert.equal(ageOn("2009-10-15", "2027-10-15"), 18);
  assert.equal(ageOn("2009-10-16", "2027-10-15"), 17);
  assert.equal(isMinor({ dateOfBirth: "2009-10-16" }, ev), true);
  assert.equal(isMinor({ dateOfBirth: "2009-10-15" }, ev), false);
});

test("the parent / guardian step only appears for under-18s", () => {
  assert.deepEqual(stepsFor({ dateOfBirth: "1990-01-01" }, ev), ["driver", "licence", "entry", "clothing", "review"]);
  assert.ok(stepsFor({ dateOfBirth: "2015-01-01" }, ev).includes("guardian"));
});

test("start permission comes from the federation, never from a tick box", () => {
  const kinds = (d: Draft) => requiredDocuments(d, ev).map((r) => r.kind + (r.required ? "" : "?"));
  assert.equal(startRuleFor({ federationId: "fed-es" }, ev), "host");
  assert.deepEqual(kinds({ federationId: "fed-es", dateOfBirth: "1990-01-01" }), ["licence_front", "licence_back"]);
  assert.deepEqual(kinds({ federationId: "fed-uk", dateOfBirth: "1990-01-01" }), ["licence_front", "licence_back"]);
  assert.deepEqual(kinds({ federationId: "fed-it", dateOfBirth: "1990-01-01" }), ["licence_front", "licence_back", "start_permission?"]);
  assert.deepEqual(kinds({ federationId: "fed-se", dateOfBirth: "1990-01-01" }), ["licence_front", "licence_back", "start_permission"]);
  assert.deepEqual(kinds({ federationId: null, federationOther: "Some ASN", dateOfBirth: "2015-01-01" }),
    ["licence_front", "licence_back", "start_permission", "entrant_licence"]);
});

test("white label: a different host country changes who needs a letter", () => {
  const italy = { ...ev, hostFederationId: "fed-it" };
  assert.equal(startRuleFor({ federationId: "fed-it" }, italy), "host");
  assert.equal(startRuleFor({ federationId: "fed-es" }, italy), "check");
});

test("price: ticket, toolkit, clothing bundle and deposit", () => {
  const q = quote({ ticketId: "o1", lines: [
    { productId: "tk", size: null, qty: 1 },
    { productId: "tee", size: "M", qty: 1 }, { productId: "polo", size: "M", qty: 1 }, { productId: "hoody", size: "L", qty: 1 },
  ] }, ev);
  // 2795 + 100 + 25 + 35 + 45 = 3000; bundle 20% of 105 = 21; + 300 deposit
  assert.equal(q.subtotalCents, 300000);
  assert.equal(q.discountCents, 2100);
  assert.equal(q.totalCents, 300000 - 2100 + 30000);
});

test("bundle counts complete sets only", () => {
  const two = quote({ ticketId: "o2", lines: [
    { productId: "tee", size: "M", qty: 2 }, { productId: "polo", size: "S", qty: 2 }, { productId: "hoody", size: "M", qty: 1 },
  ] }, ev);
  assert.equal(two.discountCents, 2100);              // one complete set
  const none = quote({ ticketId: "o2", lines: [{ productId: "tee", size: "M", qty: 3 }] }, ev);
  assert.equal(none.discountCents, 0);
});

test("the server ignores tampered lines", () => {
  const lines = cleanLines([
    { productId: "nope", size: null, qty: 1 },
    { productId: "tee", size: "XXXL", qty: 1 },
    { productId: "tee", size: "M", qty: -3 },
    { productId: "tk", size: "M", qty: 5 },
    { productId: "polo", size: "S", qty: 1 }, { productId: "polo", size: "S", qty: 2 },
  ], ev);
  assert.deepEqual(lines, [{ productId: "tk", size: null, qty: 1 }, { productId: "polo", size: "S", qty: 3 }]);
});

test("category ages and licence expiry are checked against the event date", () => {
  const e = validateStep("licence", { dateOfBirth: "2005-01-01", categoryId: "mini", licenceExpiresOn: "2027-10-01" }, ev, "2027-02-01");
  assert.match(e.categoryId, /T4 Mini is for ages 7–12/);
  assert.match(e.licenceExpiresOn, /expires before the event/);
});

test("kart fitting is only asked for when the ticket includes a kart", () => {
  assert.ok(validateStep("entry", { ticketId: "o1" }, ev, "2027-02-01").seatSize);
  assert.deepEqual(validateStep("entry", { ticketId: "o2" }, ev, "2027-02-01"), {});
});

test("cannot pay until every step and required document is done", () => {
  const d: Draft = {
    firstName: "Alex", lastName: "Moreno", gender: "Male", dateOfBirth: "2015-03-14", email: "a@example.com", phone: "1",
    addressLine1: "x", city: "y", postcode: "z", country: "Spain",
    guardianFirstName: "J", guardianLastName: "M", guardianEmail: "j@example.com", guardianPhone: "2", entrantAck: true,
    categoryId: "mini", licenceAck: true, licenceNumber: "L1", licenceExpiresOn: "2027-12-31", federationId: "fed-se", federationEmail: "f@example.com",
    startPermissionAck: true, representing: "Sweden",
    ticketId: "o2", freeTeeSize: "Youth (age 12)", termsAccepted: true, privacyAccepted: true, safetyAccepted: true,
  };
  const missing = readyToPay(d, ev, "2027-02-01", ["licence_front", "licence_back"]);
  assert.deepEqual(Object.keys(missing).sort(), ["doc.entrant_licence", "doc.start_permission"]);
  assert.deepEqual(readyToPay(d, ev, "2027-02-01", ["licence_front", "licence_back", "start_permission", "entrant_licence"]), {});
  assert.equal(displayName(d), "A. Moreno");
});

test("PINs are 6 digits and stored hashed", () => {
  const pin = newPin();
  assert.match(pin, /^\d{6}$/);
  const h = hashSecret(pin);
  assert.ok(!h.includes(pin));
  assert.ok(checkSecret(pin, h));
  assert.ok(!checkSecret(pin === "000000" ? "111111" : "000000", h));
});
