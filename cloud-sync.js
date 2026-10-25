/* Supabase adapter for account-based OMR history. Uses only the public anon key;
   authorization is enforced by the SQL RLS policies in supabase_setup.sql. */
(function () {
  const config = window.OMR_SUPABASE_CONFIG || {};
  const DB_NAME = 'omr-account-sync-v1';
  const STORE = 'pending-records';
  let client = null;

  function isConfigured() {
    if(!config.url||!config.anonKey)return false;
    try{const url=new URL(config.url);return url.protocol==='https:'||(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname));}catch{return false;}
  }
  function getClient() {
    if (!isConfigured()) throw new Error('Chưa cấu hình Supabase URL và anon key.');
    if (!client) {
      if (!window.supabase?.createClient) throw new Error('Không tải được thư viện Supabase.');
      client = window.supabase.createClient(config.url, config.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
    }
    return client;
  }
  function safeError(error) {
    return error?.message || 'Lỗi kết nối dịch vụ lưu trữ.';
  }
  function openDb() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('Trình duyệt không hỗ trợ hàng đợi lưu tạm IndexedDB.'));
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Không mở được IndexedDB.'));
    });
  }
  async function pendingPut(item) {
    const db = await openDb();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(item);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error('Không lưu được bản chờ đồng bộ.'));
        tx.onabort = () => reject(tx.error || new Error('Lưu bản chờ đồng bộ bị hủy.'));
      });
    } finally { db.close(); }
  }
  async function pendingAll(ownerId) {
    const db = await openDb();
    try {
      const all = await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const request = tx.objectStore(STORE).getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error || new Error('Không đọc được hàng đợi đồng bộ.'));
      });
      return all.filter(item => item.owner_id === ownerId);
    } finally { db.close(); }
  }
  async function pendingDelete(id) {
    const db = await openDb();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(id);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error('Không xóa được bản đã đồng bộ khỏi hàng đợi.'));
      });
    } finally { db.close(); }
  }
  async function syncOne(item) {
    const sb = getClient();
    const { data: authData, error: authError } = await sb.auth.getUser();
    if (authError) throw authError;
    if (!authData.user || authData.user.id !== item.owner_id) throw new Error('Phiên đăng nhập không khớp tài khoản của bản ghi đang chờ.');
    let imagePath = item.image_path || null;
    if (item.image_blob instanceof Blob) {
      const extension = item.image_blob.type === 'image/png' ? 'png' : item.image_blob.type === 'image/webp' ? 'webp' : 'jpg';
      imagePath = `${item.owner_id}/${item.id}.${extension}`;
      const { error } = await sb.storage.from('grading-sheets').upload(imagePath, item.image_blob, {
        contentType: item.image_blob.type || 'image/jpeg', upsert: true
      });
      if (error) throw error;
    }
    const row = {
      id: item.id, owner_id: item.owner_id,
      student_id: item.student_id || '', exam_code: item.exam_code || '',
      correct_text: item.correct_text || item.correct || '',
      correct_count: item.correct_count !== '' && Number.isFinite(Number(item.correct_count)) ? Number(item.correct_count) : null,
      question_count: Number(item.question_count) || 0,
      max_score: item.max_score !== '' && Number.isFinite(Number(item.max_score)) ? Number(item.max_score) : null,
      score: item.score !== '' && Number.isFinite(Number(item.score)) ? Number(item.score) : null,
      needs_check: Boolean(item.needs_check), check_questions: item.check_questions || [],
      recognized_answers: item.recognized_answers || [], correct_answers: item.correct_answers || [],
      question_status: item.question_status || [], incorrect_questions: item.incorrect_questions || [],
      unanswered_questions: item.unanswered_questions || [], review_details: item.review_details || [],
      processing_error: item.processing_error || '', exam_config: item.exam_config || {},
      image_path: imagePath, sync_status: 'synced', created_at: item.created_at
    };
    const { error } = await sb.from('grading_records').upsert(row, { onConflict: 'id' });
    if (error) throw error;
    await pendingDelete(item.id);
    return row;
  }
  async function saveRecord(record, imageBlob) {
    const sb = getClient();
    const { data, error } = await sb.auth.getSession();
    if (error) throw error;
    if (!data.session?.user) throw new Error('Cần đăng nhập để đồng bộ kết quả.');
    const item = {
      ...record,
      owner_id: data.session.user.id,
      image_blob: imageBlob instanceof Blob ? imageBlob : null,
      sync_status: 'pending'
    };
    await pendingPut(item);
    const syncPromise=syncOne(item).then(()=>({synced:true}),error=>{console.warn('[OMR sync] Bản ghi được giữ trong hàng đợi cục bộ để thử lại.');return{synced:false,error:safeError(error)};});
    return { queued: true, syncPromise };
  }
  async function retryPending() {
    const sb = getClient();
    const { data, error } = await sb.auth.getUser();
    if (error) throw error;
    if (!data.user) return { synced: 0, failed: 0 };
    const items = await pendingAll(data.user.id);
    let synced = 0, failed = 0;
    for (const item of items) {
      try { await syncOne(item); synced++; }
      catch (error) { failed++; console.warn('[OMR sync] Chưa đồng bộ được một bản ghi:', safeError(error)); }
    }
    return { synced, failed };
  }
  async function listRecords(page, pageSize) {
    const sb = getClient();
    const { data: authData, error: authError } = await sb.auth.getUser();
    if (authError) throw authError;
    if (!authData.user) return { rows: [], count: 0 };
    const from = Math.max(0, page) * pageSize;
    const to = from + pageSize - 1;
    const data=[];let count=0;
    for(let offset=0;offset<=to;offset+=500){
      const { data:chunk, count:total, error } = await sb.from('grading_records').select('*', { count: 'exact' })
        .order('created_at', { ascending: false }).order('id', { ascending: true }).range(offset, Math.min(to,offset+499));
      if(error)throw error;data.push(...(chunk||[]));count=total||count;if((chunk||[]).length<Math.min(500,to-offset+1))break;
    }
    const pending = await pendingAll(authData.user.id);
    const byId = new Map([...(data || []).map(row => [row.id, row]), ...pending.map(row => [row.id, row])]);
    const merged = Array.from(byId.values()).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
    return { rows: merged.slice(from, to + 1), count: Math.max(count || 0, merged.length) };
  }
  async function listAllRecords() {
    const sb=getClient();const {data:authData,error:authError}=await sb.auth.getUser();if(authError)throw authError;if(!authData.user)return[];
    const all=[];let offset=0,total=0;
    while(true){const {data,count,error}=await sb.from('grading_records').select('*',{count:'exact'}).order('created_at',{ascending:false}).order('id',{ascending:true}).range(offset,offset+499);if(error)throw error;all.push(...(data||[]));total=count||total;if((data||[]).length<500||all.length>=total)break;offset+=500;}
    const byId=new Map(all.map(row=>[row.id,row]));for(const row of await pendingAll(authData.user.id))byId.set(row.id,row);
    return Array.from(byId.values()).sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')));
  }
  async function signedImageUrl(path) {
    if (!path) return null;
    const { data, error } = await getClient().storage.from('grading-sheets').createSignedUrl(path, 300);
    if (error) throw error;
    return data?.signedUrl || null;
  }
  async function loadConfig() {
    const sb = getClient();
    const { data: authData, error: authError } = await sb.auth.getUser();
    if (authError) throw authError;
    if (!authData.user) return null;
    const { data, error } = await sb.from('user_exam_configs').select('config').eq('user_id', authData.user.id).maybeSingle();
    if (error) throw error;
    return data?.config || null;
  }
  async function saveConfig(configValue) {
    const sb = getClient();
    const { data: authData, error: authError } = await sb.auth.getUser();
    if (authError) throw authError;
    if (!authData.user) return false;
    const { error } = await sb.from('user_exam_configs').upsert({ user_id: authData.user.id, config: configValue, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (error) throw error;
    return true;
  }
  async function clearHistory() {
    const sb = getClient();
    const { data: authData, error: authError } = await sb.auth.getUser();
    if (authError) throw authError;
    if (!authData.user) throw new Error('Cần đăng nhập để xóa lịch sử tài khoản.');
    const paths=[];let offset=0,total=0;
    while(true){const {data:rows,count,error}=await sb.from('grading_records').select('image_path',{count:'exact'}).eq('owner_id',authData.user.id).range(offset,offset+499);if(error)throw error;paths.push(...(rows||[]).map(row=>row.image_path).filter(Boolean));total=count||total;if((rows||[]).length<500||offset+(rows||[]).length>=total)break;offset+=500;}
    for(let i=0;i<paths.length;i+=100){const {error}=await sb.storage.from('grading-sheets').remove(paths.slice(i,i+100));if(error)throw error;}
    const { error } = await sb.from('grading_records').delete().eq('owner_id', authData.user.id);
    if (error) throw error;
    const pending = await pendingAll(authData.user.id);
    for (const item of pending) await pendingDelete(item.id);
  }
  window.OmrCloud = {
    isConfigured, getSession: () => getClient().auth.getSession(),
    onAuthStateChange: callback => getClient().auth.onAuthStateChange(callback),
    signUp: (email, password, options = {}) => getClient().auth.signUp({ email: String(email).trim().toLowerCase(), password, options: options.redirectTo ? { emailRedirectTo: options.redirectTo } : undefined }),
    signIn: (email, password) => getClient().auth.signInWithPassword({ email: String(email).trim().toLowerCase(), password }),
    resendConfirmation: (email, redirectTo) => getClient().auth.resend({ type: 'signup', email: String(email).trim().toLowerCase(), options: redirectTo ? { emailRedirectTo: redirectTo } : undefined }),
    requestPasswordReset: (email, redirectTo) => getClient().auth.resetPasswordForEmail(String(email).trim().toLowerCase(), redirectTo ? { redirectTo } : undefined),
    updatePassword: password => getClient().auth.updateUser({ password }),
    signInWithGoogle: redirectTo => getClient().auth.signInWithOAuth({ provider: 'google', options: { ...(redirectTo ? { redirectTo } : {}), queryParams: { prompt: 'select_account' } } }),
    signOut: () => getClient().auth.signOut({ scope: 'local' }),
    saveRecord, retryPending, listRecords, listAllRecords, signedImageUrl, loadConfig, saveConfig, clearHistory
  };
})();
