import { SUPABASE_URL, SUPABASE_KEY } from './todo-config.js?v=20261118-1';
const endpoint = `${SUPABASE_URL}/functions/v1/todo-api`;
const TOKEN_KEY = 'todo-pin-session';
export class PinExpiredError extends Error {}
export async function pinRequest(action, payload = {}, token = '') {
  const response = await fetch(endpoint, { method: 'POST', headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ action, ...payload }) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) { if (response.status === 401 && action !== 'unlock') { window.dispatchEvent(new Event('todo-session-expired')); throw new PinExpiredError('PIN session expired.'); } throw new Error(body.error || (response.status === 429 ? 'Too many attempts. Try again later.' : 'Could not verify PIN.')); }
  return body;
}
export function createPinRepository({ readOnly = false } = {}) {
 const token = () => sessionStorage.getItem(TOKEN_KEY) || '';
 const data = async (operation, ...args) => {
   if (readOnly && !['lists','tasks','categories','focusTasks'].includes(operation)) throw new Error('Live preview is read-only.');
   const session = token();
   const { data: result } = await pinRequest('data', { operation, args }, session);
   if (!session || token() !== session) throw new PinExpiredError('Session locked.');
   return result;
 };
 return { lists:()=>data('lists'), categories:()=>data('categories'), createCategory:title=>data('createCategory',title), renameCategory:(id,title)=>data('renameCategory',id,title), updateList:(id,fields)=>data('updateList',id,fields), focusTasks:focus=>data('focusTasks',focus), tasks:id=>data('tasks',id), create:(id,fields)=>data('create',id,fields), update:(task,fields)=>data('update',task,fields), remove:task=>data('remove',task), rename:(id,title)=>data('rename',id,title), createList:(id,title,options={})=>data('createList',id,title,options), saveListMetadata:rows=>data('saveListMetadata',rows), saveListOrder:rows=>data('saveListOrder',rows), saveListArchive:(row,value)=>data('saveListArchive',row,value) };
}
export { TOKEN_KEY };
