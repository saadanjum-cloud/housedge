// Everything we ask a new client during onboarding, shared by the onboarding wizard and the admin's "Onboarding" tab.
// Profile answers fill the Optimise brand profile; discovery answers go into the project's discovery notes.
// [key, question, hint, max length, multi-line]
export const PROFILE_QUESTIONS = [
  ['tagline', 'Describe your company in one sentence', 'e.g. Finland’s largest food and grocery delivery app.', 200],
  ['description', 'A short description', 'What you do, for whom, and what makes you different (3 to 5 sentences).', 1200, true],
  ['audience', 'Who are your customers?', 'e.g. busy families and office workers in Finnish cities.', 400, true],
  ['products', 'Main products or services', 'One per line.', 1500, true],
  ['pricing', 'Prices and fees', 'Plans, fees and subscriptions, as customers see them.', 1500, true],
  ['trust', 'Licences, awards, partners, security', 'Anything that makes customers trust you.', 1500, true],
  ['notConfusedWith', 'Often confused with', 'Other companies with a similar name.', 300],
  ['legalName', 'Legal company name', '', 160],
  ['founded', 'Founded (year)', '', 20],
  ['headquarters', 'Headquarters', 'City, country.', 160],
];

export const DISCOVERY_QUESTIONS = [
  ['goals', 'What do you want to achieve with Housedge?', 'e.g. be the first app AI recommends for grocery delivery in Helsinki.', 2000, true],
  ['wrongFacts', 'What do AI assistants or customers get wrong about you?', 'Old prices, closed services, mix-ups with other brands…', 2000, true],
  ['news', 'Recent or upcoming changes we should know about', 'Launches, new markets, price changes, rebrands.', 2000, true],
  ['contact', 'Main contact for this project', 'Name, email and phone.', 300],
  ['reportTo', 'Who should receive reports?', 'Names and emails.', 500],
  ['notes', 'Anything else we should know?', '', 2000, true],
];

export const PROFILES_QUESTION = ['profiles', 'Official profiles', 'Your pages on LinkedIn, Wikipedia, app stores, review sites… one address per line.'];

export const FILE_TYPES = '.pdf,.png,.jpg,.jpeg,.webp,.svg,.txt,.csv,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip';
export const FILE_BUCKET = 'client-files';
export const MAX_FILE_MB = 25;

// "linkedin.com/company/x" -> "https://linkedin.com/company/x" (the profile only accepts https addresses).
export const toHttps = s => (/^https?:\/\//i.test(s) ? s.replace(/^http:/i, 'https:') : `https://${s}`);
