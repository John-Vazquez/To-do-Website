// Public browser configuration, not an authorization boundary. RLS must protect data.
export const SUPABASE_URL = "https://walsvybskelqhgvpdagj.supabase.co";
export const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndhbHN2eWJza2VscWhndnBkYWdqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc4MDQyMjUsImV4cCI6MjA3MzM4MDIyNX0.tDaLE2F2gOZnqU06Qt9XvgfeV3Qo9kdhmr-mZem7cV4";

// The eight visible custom lists keep their original DOM order. The four legacy
// academic lists, previously queried but never rendered, follow them.
export const LISTS = [
  { key: 'doing', id: 'b093c6d8-9ed6-41ec-9667-2467066b84d3', title: 'Doing Right Now', fixed: true },
  { key: 'must', id: 'df9db72b-b8ee-4178-bc1d-e5f55c9dcca7', title: 'Must Do Today', fixed: true, limit: 3 },
  { key: 'other1', id: '32dd9a59-8fa4-45f3-a20f-e801549179d1', title: 'Important 1' },
  { key: 'other2', id: '2ff32464-e2a3-43c5-adfc-cbe17439ad7d', title: 'Important 2' },
  { key: 'other3', id: '63d46c8e-16f1-4c88-b4e8-09fdfa9e93fe', title: 'Important 3' },
  { key: 'other4', id: 'e88dc7fa-6815-4eb9-8d02-cd5c023d853f', title: 'Important 4' },
  { key: 'other5', id: 'f55cf27c-0226-4440-874e-c47b7294cbf3', title: 'Important 5' },
  { key: 'other6', id: '6715ee6e-5d0f-429d-959d-3b1ea829ccf4', title: 'Important 6' },
  { key: 'other7', id: '3f716ddf-bec1-43c1-8044-410571761697', title: 'Important 7' },
  { key: 'other8', id: 'ab443152-9534-4647-8f51-ab1ffd3867ca', title: 'Important 8' },
  { key: 'discrete', id: '6226fc41-18d7-46af-95c3-4b320300b793', title: 'Discrete II' },
  { key: 'calc', id: '401cf998-6e39-4581-a2b6-0bc9655870cf', title: 'Calc III' },
  { key: 'cyber', id: '3a396ff1-962b-4357-91ff-d19fefa4a3ac', title: 'Cyber Analysis' },
  { key: 'topics', id: '61d6d0f2-2112-4cb2-9ee8-17119b631756', title: 'Topics in Cyber' }
];
