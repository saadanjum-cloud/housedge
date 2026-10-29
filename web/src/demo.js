// Local demo only: pre-fills the /onboarding sign-up form with a real prospect (Kays, joinkays.com), so a full
// client onboarding can be recorded quickly. The setup steps are then filled by "Fill in from our website".
// Production builds replace DEMO with null and drop this data. The password comes from web/.env.local
// (VITE_DEMO_PASSWORD), never from the code.
const KAYS = {
  signup: { name: 'Kays Founder', email: 'founder@kays.test', company: 'Kays', website: 'joinkays.com', password: import.meta.env.VITE_DEMO_PASSWORD },
};

export const DEMO = import.meta.env.DEV ? KAYS : null;
