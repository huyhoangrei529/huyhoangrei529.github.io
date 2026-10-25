let NQ = 50;
let MAX_SCORE = 10;
const MAX_QUESTIONS=60, CHOICES=['A','B','C','D'];
const W=2480, H=3508, TEMPLATE_W=1024, TEMPLATE_H=1448, PAGE_MM_W=210, PAGE_MM_H=297;
const X=v=>v*W/TEMPLATE_W, Y=v=>v*H/TEMPLATE_H;
const MARKER_DST=[[X(56),Y(49)],[X(969),Y(49)],[X(969),Y(1400)],[X(56),Y(1400)]];
const SID_X=[692,724,755,786].map(X), SID_Y=[194,218,243,267,293,319,345,370,396,421].map(Y);
const EXAM_X=[906,938].map(X), EXAM_Y=SID_Y;
const ANSWER_X=[[116,156,198,237],[358,398,438,477],[597,637,676,714],[834,874,913,952]].map(col=>col.map(X));
const ANSWER_Y_TEMPLATE=[549,600,654,706,760,815,869,922,977,1032,1087,1141,1196,1251,1307];
const ANSWER_Y=ANSWER_Y_TEMPLATE.map(Y), ANSWER_MARKER_X=[261,499,735,974].map(X);
const OUTLINE_MARKER_DST=ANSWER_MARKER_X.map(x=>[x,Y(1307)]); const ANS_LEFT_X=ANSWER_X[0], ANS_RIGHT_X=ANSWER_X[1];
let cvReady=false, currentImage=null,cvInitPromise=null,cvInitError=null,cvLoadState="idle",cvObservedPromise=null,cvResolveAttempt=null,cvRejectAttempt=null,appBootstrapError=null,cameraStartPending=false;
let currentUser=null,accountDataReady=false,cloudHistoryEnabled=false,historyPage=0,historyPageSize=25,historyRowsCache=[],historyTotal=0,historyLoading=false,historyImageObjectUrl=null,cloudConfigSaveTimer=null;
const $=id=>document.getElementById(id);
const keys={};

const HISTORY_KEY = "omr28_history_v2";

function getLocalHistory() {
    try {
        const raw = localStorage.getItem(HISTORY_KEY);
        return raw ? JSON.parse(raw).map(normalizeHistoryRow) : [];
    } catch (error) {
        console.warn("Không đọc được lịch sử:", error);
        return [];
    }
}
function getHistory() {
    if (cloudHistoryEnabled) return historyRowsCache;
    if (window.OmrCloud?.isConfigured() && currentUser) return [];
    return getLocalHistory();
}

function normalizeHistoryRow(row,index=0) {
    const count = Number(row.correct_count);
    const questionCount = Number(row.question_count) || NQ;
    const createdAt = row.created_at || row.time || new Date().toISOString();
    return { ...row,id:row.id||`local-${encodeURIComponent(String(row.time||createdAt))}-${index}`,
        correct: row.correct_text || row.correct || (Number.isFinite(count) ? `${count}/${questionCount}` : ''),
        correct_count: Number.isFinite(count) ? count : Number.parseInt(String(row.correct || row.correct_text || '').split('/')[0], 10),
        question_count: questionCount,
        check_questions: row.check_questions || row.checkQuestions || [],
        time: row.time || new Date(createdAt).toLocaleString('vi-VN'),
        created_at: createdAt,
        sync_status: row.sync_status || 'local'
    };
}

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    }[char]));
}

function renderHistory() {
    const tbody = document.querySelector("#historyTable tbody");
    const count = document.getElementById("historyCount");

    if (!tbody) {
        return;
    }

    const rows = getHistory();

    tbody.innerHTML = rows.length ? rows.map(row => {
        const correct = Number.parseInt(
            String(row.correct ?? row.correct_text ?? "").split("/")[0],
            10
        );
        const dung = Number.isFinite(correct) ? correct : 0;
        const total = Number(row.question_count) || NQ;
        const score = Number.isFinite(Number(row.score)) ? Number(row.score) : 0;
        const scoreText = score.toFixed(2).replace(/\.00$/, ".0");
        const scoreDisplay = row.needs_check ? `${scoreText}*` : scoreText;
        const checks = Array.isArray(row.check_questions) ? row.check_questions.map(q=>`Q${q}`).join(', ') : '';
        const wrong = Array.isArray(row.incorrect_questions) ? row.incorrect_questions.map(q=>`Q${q}`).join(', ') : '';
        const correctText = row.correct || `${dung}/${total}`;
        return `
            <tr class="history-row" data-record-id="${escapeHtml(row.id || '')}" tabindex="0" role="button" aria-label="Mở chi tiết bài ${escapeHtml(row.student_id || '')}">
                <td>${escapeHtml(row.student_id || "—")}</td>
                <td>${escapeHtml(row.exam_code || "—")}</td>
                <td style="text-align:center">${escapeHtml(correctText)}</td>
                <td style="text-align:center">${scoreDisplay}</td>
                <td>${row.needs_check ? 'Cần kiểm tra' : 'Đã chấm'}${row.sync_status==='pending'?' · Chờ đồng bộ':''}</td>
                <td>${escapeHtml(checks || '—')}</td>
                <td>${escapeHtml(wrong || '—')}</td>
                <td>${escapeHtml(row.time)}</td>
            </tr>
        `;
    }).join("") : `<tr><td class="empty-history" colspan="8">${historyLoading?'Đang tải lịch sử…':'Chưa có bài nào trong lịch sử trên thiết bị này.'}</td></tr>`;

    if (count) {
        count.textContent = cloudHistoryEnabled
            ? `Lịch sử tài khoản: ${historyTotal} bài · Trang ${historyPage+1}.`
            : (rows.length ? `Lịch sử trên thiết bị này: ${rows.length} bài.` : "Chưa có bài nào.");
    }
    const pageLabel=$('historyPageLabel'); if(pageLabel)pageLabel.textContent=cloudHistoryEnabled?`Trang ${historyPage+1} · ${historyTotal} bài`:'Lưu trên thiết bị';
    const prev=$('historyPrevBtn'),next=$('historyNextBtn'); if(prev)prev.disabled=historyLoading||historyPage===0; if(next)next.disabled=historyLoading||!cloudHistoryEnabled||(historyPage+1)*historyPageSize>=historyTotal;
    tbody.querySelectorAll('.history-row').forEach(row=>{row.addEventListener('click',()=>openHistoryDetail(row.dataset.recordId));row.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openHistoryDetail(row.dataset.recordId);}});});
}

function makeHistoryRecord(data) {
    const createdAt=new Date().toISOString();
    return normalizeHistoryRow({
        id:data.id||newRecordId(),
        created_at:createdAt,
        student_id: data.student_id || "",
        exam_code: data.exam_code || "",
        correct_text: data.correct_text || "",
        correct_count:Number.parseInt(String(data.correct_text||'').split('/')[0],10)||0,
        score: data.score ?? "",
        question_count: Number(data.question_count) || NQ,
        max_score: Number(data.max_score) || MAX_SCORE,
        needs_check: Boolean(data.needs_check),
        check_questions: Array.isArray(data.check_questions) ? data.check_questions : [],
        recognized_answers: Array.isArray(data.recognized_answers) ? data.recognized_answers : [],
        correct_answers: Array.isArray(data.correct_answers) ? data.correct_answers : [],
        question_status: Array.isArray(data.question_status) ? data.question_status : [],
        incorrect_questions: Array.isArray(data.incorrect_questions) ? data.incorrect_questions : [],
        unanswered_questions: Array.isArray(data.unanswered_questions) ? data.unanswered_questions : [],
        review_details: Array.isArray(data.review_details) ? data.review_details : [],
        processing_error: data.processing_error || "",
        exam_config: getCurrentExamConfigSnapshot(),
        image_path:null,
        sync_status:currentUser?'pending':'local'
    });
}

function newRecordId(){if(window.crypto?.randomUUID)return window.crypto.randomUUID();const bytes=new Uint8Array(16);window.crypto?.getRandomValues?.(bytes);if(!bytes.some(Boolean))for(let i=0;i<16;i++)bytes[i]=Math.floor(Math.random()*256);bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;const hex=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;}

async function saveHistoryRecord(data,imageBlob,expectedUserId=currentUser?.id||null) {
    const record=makeHistoryRecord(data);
    if(currentUser&&currentUser.id===expectedUserId&&window.OmrCloud?.isConfigured()){
        $('historySyncStatus').textContent='Đang lưu kết quả và ảnh vào tài khoản…';
        $('historySyncStatus').classList.remove('error');
        try{const queued=await window.OmrCloud.saveRecord(record,imageBlob);$('historySyncStatus').textContent='Đã lưu an toàn trên thiết bị; đang đồng bộ kết quả và ảnh…';$('historyRetryBtn').classList.add('hidden');void refreshHistory(historyPage);queued.syncPromise.then(result=>{if(result.synced){$('historySyncStatus').textContent='Đã đồng bộ lịch sử và ảnh lên tài khoản.';$('historySyncStatus').classList.remove('error');$('historyRetryBtn').classList.add('hidden');}else{$('historySyncStatus').textContent=`Bản ghi vẫn được giữ trên thiết bị để thử lại: ${result.error||'lỗi mạng.'}`;$('historySyncStatus').classList.add('error');$('historyRetryBtn').classList.remove('hidden');}void refreshHistory(historyPage);});return true;}
        catch(error){$('historySyncStatus').textContent=`Không thể lưu bản ghi vào hàng đợi thiết bị: ${error.message||error}. Hãy giữ trang mở và thử chấm lại.`;$('historySyncStatus').classList.add('error');$('historyRetryBtn').classList.add('hidden');console.error('[OMR sync] Không thể xếp bản ghi vào hàng đợi.');return false;}
    }
    record.sync_status='local';
    const rows = getLocalHistory();
    rows.unshift({ ...record, correct:record.correct_text, time:record.time });
    try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(rows.slice(0, 500)));
    } catch (error) {
        console.error("Không lưu được lịch sử:", error);
        return false;
    }

    renderHistory();
    return true;
}

async function refreshHistory(page=historyPage){
    historyPage=Math.max(0,page);historyLoading=true;renderHistory();
    const requestedUserId=currentUser?.id||null;
    if(currentUser&&window.OmrCloud?.isConfigured()){
        cloudHistoryEnabled=true;
        try{const result=await window.OmrCloud.listRecords(historyPage,historyPageSize);if(requestedUserId!==(currentUser?.id||null))return;historyRowsCache=(result.rows||[]).map(normalizeHistoryRow);historyTotal=result.count||0;$('historySubtitle').textContent=`Đã đồng bộ với tài khoản ${currentUser.email||''}. Chọn một dòng để xem ảnh và chi tiết.`;}
        catch(error){if(requestedUserId!==(currentUser?.id||null))return;$('historySyncStatus').textContent=`Không tải được lịch sử từ máy chủ: ${error.message||error}`;$('historySyncStatus').classList.add('error');historyRowsCache=[];historyTotal=0;}
    }else{cloudHistoryEnabled=false;historyRowsCache=[];historyTotal=0;if($('historySubtitle'))$('historySubtitle').textContent=window.OmrCloud?.isConfigured()?'Đăng nhập để đồng bộ lịch sử giữa các thiết bị.':'Chế độ cục bộ: dữ liệu chỉ nằm trên thiết bị này.';}
    historyLoading=false;renderHistory();
}

function setDetailText(id,value){const node=$(id);if(node)node.textContent=value;}
async function openHistoryDetail(id){
    const transition=authTransitionId;const row=getHistory().find(item=>String(item.id)===String(id));if(!row)return;
    setDetailText('historyDetailTime',row.time||'');setDetailText('detailSid',row.student_id||'—');setDetailText('detailExam',row.exam_code||'—');setDetailText('detailCorrect',row.correct||'—');
    const score=Number.isFinite(Number(row.score))?Number(row.score).toFixed(2):'—';setDetailText('detailScore',score+(row.needs_check?'*':''));
    setDetailText('detailStatus',row.processing_error?`Lỗi xử lý: ${row.processing_error}`:(row.needs_check?'CẦN KIỂM TRA':'Đã chấm'));
    setDetailText('detailChecks',(row.check_questions||[]).map(q=>`Q${q}`).join(', ')||'Không có');setDetailText('detailWrong',(row.incorrect_questions||[]).map(q=>`Q${q}`).join(', ')||'Không có');
    setDetailText('detailReview',(row.review_details||[]).join('; ')||row.processing_error||'Không có');
    const answers=Array.isArray(row.recognized_answers)?row.recognized_answers:[];setDetailText('detailAnswers',answers.length?answers.map((a,i)=>`C${i+1}: ${a||'BO_TRONG'}`).join('\n'):'Không lưu được danh sách đáp án chi tiết.');
    const wrap=$('historyDetailImageWrap');wrap.replaceChildren();
    try{
        let src=null;if(row.image_path&&currentUser)src=await window.OmrCloud.signedImageUrl(row.image_path);else if(row.image_blob instanceof Blob){historyImageObjectUrl=URL.createObjectURL(row.image_blob);src=historyImageObjectUrl;}
        if(src){const image=new Image();image.id='historyDetailImage';image.alt='Ảnh phiếu trả lời đã chấm';image.src=src;image.onerror=()=>wrap.replaceChildren(Object.assign(document.createElement('span'),{className:'detail-image-placeholder',textContent:'Không tải được ảnh phiếu đã lưu.'}));wrap.appendChild(image);}
        else wrap.appendChild(Object.assign(document.createElement('span'),{className:'detail-image-placeholder',textContent:'Ảnh phiếu không có trong bản ghi này.'}));
    }catch(error){wrap.appendChild(Object.assign(document.createElement('span'),{className:'detail-image-placeholder',textContent:`Không tải được ảnh đã lưu: ${error.message||error}`}));}
    if(transition!==authTransitionId)return;
    $('historyDetailDialog').showModal();
}

function safeHistoryValue(value){return value===undefined||value===null?'':value;}
async function exportHistoryExcel(){let rows=getHistory();if(currentUser&&window.OmrCloud?.isConfigured()){try{rows=(await window.OmrCloud.listAllRecords()).map(normalizeHistoryRow);}catch(error){alert(`Không tải được lịch sử để xuất: ${error.message||error}`);return;}}if(!rows.length){alert('Chưa có bài nào trong lịch sử.');return;}if(typeof XLSX==='undefined'){alert('Không tải được thư viện Excel SheetJS. Hãy kiểm tra kết nối mạng rồi tải lại trang.');return;}const mainHeaders=['Mã sinh viên','Mã đề','Số câu chấm','Số đúng','Số sai','Bỏ trống','Câu trả lời sai','Điểm (số)','Điểm hiển thị','Cần kiểm tra','Chi tiết kiểm tra','Lỗi xử lý','Thời gian'];const main=[['* = Cần kiểm tra thủ công'],mainHeaders];const detail=[['Mã sinh viên','Mã đề','Câu hỏi','Đáp án học sinh','Đáp án đúng','Kết quả','Chi tiết kiểm tra']];for(const row of rows){const n=Number(row.question_count)||Number(String(row.correct||'').split('/')[1])||NQ,correct=Number.parseInt(String(row.correct||'').split('/')[0],10),answers=Array.isArray(row.recognized_answers)?row.recognized_answers:[],keys=Array.isArray(row.correct_answers)?row.correct_answers:[],statuses=Array.isArray(row.question_status)?row.question_status:[],incorrect=Array.isArray(row.incorrect_questions)?row.incorrect_questions:[],unanswered=Array.isArray(row.unanswered_questions)?row.unanswered_questions:[],reviewDetails=Array.isArray(row.review_details)?row.review_details:[],processingError=String(row.processing_error||''),numCorrect=Number.isFinite(correct)?correct:'',scoreNum=row.score!==''&&row.score!==null&&Number.isFinite(Number(row.score))?Number(row.score):null,needsReview=Boolean(row.needs_check||processingError||reviewDetails.length),scoreText=scoreNum===null?'':`${scoreNum.toFixed(2)}${needsReview?'*':''}`,wrongCount=processingError?'':(Array.isArray(row.incorrect_questions)?incorrect.length:''),unansweredCount=processingError&&!statuses.length?'':unanswered.length,legacyReview=Array.isArray(row.check_questions)?row.check_questions:[],reviewText=reviewDetails.length?reviewDetails.join('; '):(legacyReview.length?legacyReview.map(q=>['Q',q,': flagged for review; reason not retained in the original record'].join('')).join('; '):(needsReview?'Requires manual review':'None')),incorrectText=incorrect.length?incorrect.map(q=>`Q${q}`).join(', '):'None';main.push([safeHistoryValue(row.student_id)||'—',safeHistoryValue(row.exam_code)||'—',n,numCorrect,wrongCount,unansweredCount,incorrectText,scoreNum,scoreText,needsReview?'Yes':'No',reviewText,processingError||'None',safeHistoryValue(row.time)]);for(let q=0;q<n;q++){const student=answers[q]||'',key=keys[q]||'',status=statuses[q]||'',qReview=status==='TO_2_HOAC_NHIEU'?'Multiple options marked':status==='BO_TRONG'?'No answer marked':status==='OK_NHAT'?'': '',paperReview=[processingError,...reviewDetails.filter(x=>!x.startsWith('Q'))].filter(Boolean).join('; ');let result,details=qReview||paperReview;if(paperReview)result='Requires Review';else if(status==='TO_2_HOAC_NHIEU'||student==='?')result='Requires Review';else if(!student||status==='BO_TRONG')result='Unanswered';else if(!key)result=paperReview?'Requires Review':'Unknown';else result=student===key?'Correct':'Incorrect';if(!details&&needsReview&&reviewDetails.length)details=reviewDetails.filter(x=>x.includes(`Q${q+1}`)).join('; ');detail.push([safeHistoryValue(row.student_id)||'—',safeHistoryValue(row.exam_code)||'—',q+1,student||'Unanswered',key||'',result,details||'None']);}}const wb=XLSX.utils.book_new(),ws=XLSX.utils.aoa_to_sheet(main),ds=XLSX.utils.aoa_to_sheet(detail);ws['!cols']=[{wch:18},{wch:12},{wch:14},{wch:12},{wch:12},{wch:12},{wch:28},{wch:14},{wch:17},{wch:17},{wch:56},{wch:48},{wch:22}];ds['!cols']=[{wch:18},{wch:12},{wch:12},{wch:20},{wch:18},{wch:20},{wch:48}];ws['!autofilter']={ref:`A2:M${Math.max(2,main.length)}`};ds['!autofilter']={ref:`A1:G${Math.max(1,detail.length)}`};for(let i=0;i<rows.length;i++){const cell=XLSX.utils.encode_cell({r:i+2,c:7});if(ws[cell]&&typeof ws[cell].v==='number')ws[cell].z='0.00';}XLSX.utils.book_append_sheet(wb,ws,'Results');XLSX.utils.book_append_sheet(wb,ds,'Answer Details');XLSX.writeFile(wb,'ket_qua_cham_omr.xlsx',{compression:true});}
async function clearHistory() {
    if (!confirm("Xóa toàn bộ lịch sử bài đã chấm của tài khoản này, bao gồm ảnh phiếu? Thao tác này không thể hoàn tác.")) return;
    if(currentUser&&window.OmrCloud?.isConfigured()){
        $('historySyncStatus').textContent='Đang xóa lịch sử và ảnh đã lưu…';
        try{await window.OmrCloud.clearHistory();historyRowsCache=[];historyTotal=0;historyPage=0;$('historySyncStatus').textContent='Đã xóa lịch sử tài khoản.';$('historySyncStatus').classList.remove('error');await refreshHistory(0);}
        catch(error){$('historySyncStatus').textContent=`Không xóa được lịch sử: ${error.message||error}`;$('historySyncStatus').classList.add('error');}
        return;
    }
    localStorage.removeItem(HISTORY_KEY);renderHistory();
}

function orderPoints(pts) {
      if(pts.length!==4) throw new Error('Cần đúng 4 điểm.');
      const s=pts.map(p=>p[0]+p[1]);
      const d=pts.map(p=>p[1]-p[0]);
      return [pts[s.indexOf(Math.min(...s))], pts[d.indexOf(Math.min(...d))], pts[s.indexOf(Math.max(...s))], pts[d.indexOf(Math.max(...d))]].map(p=>[p[0], p[1]]);
}
function dist(a, b) {
    return Math.hypot(a[0]-b[0], a[1]-b[1]);
}
function contourArea(points) {
      let a=0;
     for(let i=0; i<points.length; i++) {
        const p=points[i], q=points[(i+1)%points.length];
        a+=p[0]*q[1]-q[0]*p[1];
    }
     return Math.abs(a/2);
}
function quadQuality(pts) {
      const p=orderPoints(pts);
     const top=dist(p[1], p[0]),  right=dist(p[2], p[1]),  bottom=dist(p[2], p[3]),  left=dist(p[3], p[0]);
      if([top, right, bottom, left].some(x=>x<=1)) return -1;
      const observed=((top+bottom)/2)/((left+right)/2),  target=PAGE_MM_W/PAGE_MM_H;
      const ratioErr=Math.abs(Math.log(Math.max(observed, 1e-6)/Math.max(target, 1e-6)));
      const parallelH=Math.abs(top-bottom)/Math.max(top, bottom),  parallelV=Math.abs(left-right)/Math.max(left, right);
      return -(2*ratioErr+parallelH+parallelV);
}
function _squareLike(c){const area=cv.contourArea(c);if(area<25)return null;const peri=cv.arcLength(c,true);if(peri<=0)return null;const ap=new cv.Mat();cv.approxPolyDP(c,ap,0.045*peri,true);if(ap.rows!==4||!cv.isContourConvex(ap)){ap.delete();return null;}const r=cv.boundingRect(ap);ap.delete();if(Math.min(r.width,r.height)<5||Math.max(r.width,r.height)/Math.max(1,Math.min(r.width,r.height))>1.35)return null;return{...r,area};}
function claheGray(src,clipLimit=2.0,gridSize=8){const w=src.cols,h=src.rows,data=src.data,tilesX=gridSize,tilesY=gridSize,maps=[],tw=Math.ceil(w/tilesX),th=Math.ceil(h/tilesY);for(let ty=0;ty<tilesY;ty++)for(let tx=0;tx<tilesX;tx++){const x0=Math.floor(tx*w/tilesX),x1=Math.floor((tx+1)*w/tilesX),y0=Math.floor(ty*h/tilesY),y1=Math.floor((ty+1)*h/tilesY),area=(x1-x0)*(y1-y0),hist=new Uint32Array(256);for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)hist[data[y*w+x]]++;const limit=Math.max(1,Math.floor(clipLimit*area/256));let excess=0;for(let i=0;i<256;i++)if(hist[i]>limit){excess+=hist[i]-limit;hist[i]=limit;}const batch=Math.floor(excess/256),residual=excess-batch*256;if(batch)for(let i=0;i<256;i++)hist[i]+=batch;for(let i=0;i<residual;i++)hist[Math.floor(i*256/residual)]++;let cdf=0,cdfMin=0;for(let i=0;i<256;i++){cdf+=hist[i];if(!cdfMin&&cdf)cdfMin=cdf;}const lut=new Uint8Array(256),den=Math.max(1,area-cdfMin);cdf=0;for(let i=0;i<256;i++){cdf+=hist[i];lut[i]=Math.max(0,Math.min(255,Math.round((cdf-cdfMin)*255/den)));}maps.push(lut);}const out=new cv.Mat(h,w,cv.CV_8UC1);const dst=out.data;for(let y=0;y<h;y++){const fy=(y+0.5)*tilesY/h-0.5,y0=Math.max(0,Math.floor(fy)),y1=Math.min(tilesY-1,y0+1),wy=Math.max(0,Math.min(1,fy-y0));for(let x=0;x<w;x++){const fx=(x+0.5)*tilesX/w-0.5,x0=Math.max(0,Math.floor(fx)),x1=Math.min(tilesX-1,x0+1),wx=Math.max(0,Math.min(1,fx-x0)),v=data[y*w+x],a=maps[y0*tilesX+x0][v]*(1-wx)+maps[y0*tilesX+x1][v]*wx,b=maps[y1*tilesX+x0][v]*(1-wx)+maps[y1*tilesX+x1][v]*wx;dst[y*w+x]=Math.round(a*(1-wy)+b*wy);}}return out;}function squareCandidates(img){const gray=new cv.Mat();cv.cvtColor(img,gray,cv.COLOR_RGBA2GRAY);const originalW=gray.cols,originalH=gray.rows,scale=Math.min(1,1600/Math.max(originalW,originalH));let small=gray;if(scale<1){small=new cv.Mat();cv.resize(gray,small,new cv.Size(0,0),scale,scale,cv.INTER_AREA);}const enhanced=claheGray(small,2,8);const h=small.rows,w=small.cols,found=[];try{for(const src of [small,enhanced])for(const threshold of [45,65,85,105,130,155,180]){const bw=new cv.Mat(),contours=new cv.MatVector(),hierarchy=new cv.Mat();cv.threshold(src,bw,threshold,255,cv.THRESH_BINARY_INV);cv.findContours(bw,contours,hierarchy,cv.RETR_TREE,cv.CHAIN_APPROX_SIMPLE);const squares=[];for(let i=0;i<contours.size();i++){const c=contours.get(i),r=_squareLike(c);if(!r){c.delete();continue;}if(Math.max(r.width,r.height)<0.012*Math.min(h,w)||Math.max(r.width,r.height)>0.13*Math.min(h,w)){c.delete();continue;}const m=cv.moments(c);if(Math.abs(m.m00)<1e-6){c.delete();continue;}squares.push({i,cx:m.m10/m.m00,cy:m.m01/m.m00,sw:r.width,sh:r.height,area:r.area,x:r.x,y:r.y});c.delete();}for(const f of squares)for(const q of squares){if(f.i===q.i||q.area>=f.area)continue;const ratio=Math.max(f.sw,f.sh)/Math.max(1,Math.max(q.sw,q.sh));if(ratio<1.35||ratio>3.4||Math.hypot(f.cx-q.cx,f.cy-q.cy)>0.20*Math.max(f.sw,f.sh))continue;if(q.x<f.x-1||q.x>f.x+f.sw+1||q.y<f.y-1||q.y>f.y+f.sh+1)continue;const ar=q.area/Math.max(f.area,1);if(ar<0.08||ar>0.70)continue;found.push({center:[q.cx,q.cy],area:f.area,ratio:ar});}contours.delete();hierarchy.delete();bw.delete();}const merge=Math.max(8,0.012*Math.min(h,w)),merged=[];found.sort((a,b)=>b.area-a.area);for(const p of found){const hit=merged.find(q=>dist(p.center,q.center)<merge);if(!hit)merged.push({...p,count:1});else{hit.center=[(hit.center[0]*hit.count+p.center[0])/(hit.count+1),(hit.center[1]*hit.count+p.center[1])/(hit.count+1)];hit.count++;hit.area=Math.max(hit.area,p.area);hit.ratio=Math.max(hit.ratio,p.ratio);}}const candidates=merged.sort((a,b)=>b.count-a.count||b.area-a.area).slice(0,16);if(candidates.length<4)throw new Error(`Chỉ nhận được ${candidates.length}/4 marker chính; cần ảnh rõ đủ bốn marker viền-lõi.`);let best=null;for(let a=0;a<candidates.length-3;a++)for(let b=a+1;b<candidates.length-2;b++)for(let c=b+1;c<candidates.length-1;c++)for(let d=c+1;d<candidates.length;d++){let ordered;try{ordered=orderPoints([candidates[a].center,candidates[b].center,candidates[c].center,candidates[d].center]);}catch{continue;}const area=contourArea(ordered);if(area<0.12*w*h)continue;const edges=ordered.map((p,i)=>dist(p,ordered[(i+1)%4]));if(Math.min(...edges)<0.20*Math.min(h,w))continue;const cross=[];for(let i=0;i<4;i++){const A=ordered[i],B=ordered[(i+1)%4],C=ordered[(i+2)%4];cross.push((B[0]-A[0])*(C[1]-B[1])-(B[1]-A[1])*(C[0]-B[0]));}if(Math.min(...cross)*Math.max(...cross)<=0)continue;const aspect=((edges[0]+edges[2])/2)/Math.max(1e-6,(edges[1]+edges[3])/2);if(aspect<0.30||aspect>1.60)continue;const score=area/(w*h)+0.003*[a,b,c,d].reduce((sum,k)=>sum+candidates[k].count,0)-Math.abs(Math.log(aspect/(210/297)))*0.035;if(!best||score>best.score)best={score,ordered};}if(!best)throw new Error('Đã thấy marker vuông nhưng bốn góc không tạo thành khung trang hợp lệ. Hãy chụp trọn tờ phiếu, tránh cắt mất góc.');return best.ordered.map(p=>[p[0]/scale,p[1]/scale]);}finally{gray.delete();if(small!==gray)small.delete();enhanced.delete();}}
function clusterSquareCandidates(candidates,minDim){return candidates;}
function selectPrimaryMarkers(candidates,shape){return candidates;}
function findBlackMarkerPage(img){return squareCandidates(img);}
function makePointMat(points){if(!Array.isArray(points)||points.length!==4)throw new Error('Homography cần đúng bốn marker.');const m=new cv.Mat(4,1,cv.CV_32FC2),flat=[];for(const p of points)flat.push(Number(p[0]),Number(p[1]));m.data32F.set(flat);return m;}
function warpSingle(img,marker=findBlackMarkerPage(img)){if(!marker||marker.length!==4)throw new Error('Không tìm được đủ bốn marker góc của phiếu.');const src=makePointMat(marker),dst=makePointMat(MARKER_DST);let M=null,warped=null,mapped=null;try{M=cv.getPerspectiveTransform(src,dst);if(!M||M.empty()||Math.abs(cv.countNonZero(M))===0)throw new Error('Không tạo được ma trận homography hợp lệ.');mapped=new cv.Mat();cv.perspectiveTransform(src,mapped,M);const vals=mapped.data32F;let err=0;for(let i=0;i<4;i++)err=Math.max(err,Math.hypot(vals[2*i]-MARKER_DST[i][0],vals[2*i+1]-MARKER_DST[i][1]));if(!Number.isFinite(err)||err>2)throw new Error(`Sai số căn chỉnh marker quá lớn (${err.toFixed(1)} px).`);warped=new cv.Mat();cv.warpPerspective(img,warped,M,new cv.Size(W,H),cv.INTER_CUBIC,cv.BORDER_CONSTANT,new cv.Scalar(255,255,255,255));if(warped.empty()||warped.cols!==2480||warped.rows!==3508)throw new Error('Kích thước ảnh chuẩn hóa không đúng 2480×3508.');return{warped,marker};}catch(e){if(warped)warped.delete();throw e;}finally{src.delete();dst.delete();if(M)M.delete();if(mapped)mapped.delete();}}
function rotateImage(img,code){const out=new cv.Mat();cv.rotate(img,out,code);return out;}
function warp(img){const first=findBlackMarkerPage(img);const edges=first.map((p,i)=>dist(p,first[(i+1)%4])),ratio=((edges[0]+edges[2])/2)/Math.max(1e-6,(edges[1]+edges[3])/2);const candidates=ratio>1.12?[{image:rotateImage(img,cv.ROTATE_90_CLOCKWISE),name:'xoay 90° thuận chiều kim đồng hồ',owned:true},{image:rotateImage(img,cv.ROTATE_90_COUNTERCLOCKWISE),name:'xoay 90° ngược chiều kim đồng hồ',owned:true}]:[{image:img,name:'ảnh gốc',owned:false},{image:rotateImage(img,cv.ROTATE_180),name:'xoay 180°',owned:true}];const evaluated=[],errors=[];for(const item of candidates){try{const result=warpSingle(item.image,item.image===img?first:findBlackMarkerPage(item.image)),rowReport=refineAnswerRows(result.warped);evaluated.push({result,item,matches:rowReport.matched,rowReport});}catch(e){errors.push(`${item.name}: ${e.message||e}`);}finally{if(item.owned)item.image.delete();}}if(!evaluated.length)throw new Error(`Không hiệu chỉnh được ảnh theo marker góc. ${errors.join(' | ')}`);evaluated.sort((a,b)=>b.matches-a.matches);for(let i=1;i<evaluated.length;i++)evaluated[i].result.warped.delete();return{...evaluated[0].result,rowMatches:evaluated[0].matches,rowReport:evaluated[0].rowReport};}
function bubbleMetrics(gray, x, y, coreR=10, ann1=16, ann2=25) {
    const ix=Math.round(x), iy=Math.round(y), h=gray.rows, w=gray.cols;
    let coreSum=0, coreN=0, annSum=0, annN=0, coreSq=0;
    for(let yy=Math.max(0, iy-ann2); yy<=Math.min(h-1, iy+ann2); yy++)for(let xx=Math.max(0, ix-ann2); xx<=Math.min(w-1, ix+ann2); xx++) {
        const d2=(xx-ix)**2+(yy-iy)**2, v=gray.ucharPtr(yy, xx)[0];
        if(d2<=coreR**2) {
            coreSum+=v;
            coreSq+=v*v;
            coreN++;
        } else if(d2>=ann1**2&&d2<=ann2**2) {
            annSum+=v;
            annN++;
        }
    }
    if(!coreN||!annN)return [0, 0, 255];
    const cm=coreSum/coreN, am=annSum/annN;
    return [am-cm, Math.sqrt(Math.max(0, coreSq/coreN-cm*cm)), cm];
}
function markEvidence(d, t, m) {
    return d>=10&&m<=225 || (t>=12&&m>=120&&d>=4);
}
function readGrid(gray, xs, ys) {
    const vals=[], textures=[], means=[], evidence=[], results=[], flags=[];
    for(let r=0; r<ys.length; r++) {
        vals[r]=[];
        textures[r]=[];
        means[r]=[];
        evidence[r]=[];
        for(let c=0; c<xs.length; c++) {
            const [d, t, m]=bubbleMetrics(gray, xs[c], ys[r]);
            vals[r][c]=d;
            textures[r][c]=t;
            means[r][c]=m;
            evidence[r][c]=markEvidence(d, t, m);
        }
        const marked=evidence[r].map((v, i)=>v?i: -1).filter(i=>i>=0);
        if(!marked.length) {
            results.push('');
            flags.push('BO_TRONG');
        } else if(marked.length>1) {
            const strong=marked.filter(c=>vals[r][c]>=10);
            if(strong.length>1) {
                results.push('?');
                flags.push('TO_2_HOAC_NHIEU');
            } else {
                results.push(String(marked[0]));
                flags.push('OK_NHAT');
            }
        } else {
            results.push(String(marked[0]));
            flags.push(vals[r][marked[0]]>=10?'OK': 'OK_NHAT');
        }
    }
     return {
        results, vals, textures, means, evidence, flags
    };
}
function readSid(gray){const vals=Array.from({length:10},()=>[]),sc=Array.from({length:10},()=>[]);for(let r=0;r<10;r++)for(let c=0;c<4;c++){const[d,t,m]=bubbleMetrics(gray,SID_X[c],SID_Y[r],Math.max(3,Math.round(5.5*W/TEMPLATE_W)),Math.max(5,Math.round(13.5*W/TEMPLATE_W)),Math.max(7,Math.round(18.5*W/TEMPLATE_W)));sc[r][c]=d;vals[r][c]=markEvidence(d,t,m,true);}const digits=[];for(let c=0;c<4;c++){const marked=Array.from({length:10},(_,r)=>r).filter(r=>vals[r][c]);if(!marked.length){digits.push('');continue;}marked.sort((a,b)=>sc[b][c]-sc[a][c]);if(marked.length>1&&sc[marked[1]][c]>=12&&sc[marked[0]][c]-sc[marked[1]][c]<4)digits.push('?');else digits.push(String(marked[0]));}return{sid:digits.join('')};}
function readExam(gray){const g=readDigitGrid(gray,EXAM_X,EXAM_Y),ds=[];for(let c=0;c<2;c++){const marked=Array.from({length:10},(_,r)=>r).filter(r=>g.evidence[r][c]);if(!marked.length){ds.push('');continue;}marked.sort((a,b)=>g.vals[b][c]-g.vals[a][c]);if(marked.length>1&&g.vals[marked[1]][c]>=12&&g.vals[marked[0]][c]-g.vals[marked[1]][c]<4)ds.push('?');else ds.push(String(marked[0]));}return{exam:ds.join('')};}function readDigitGrid(gray,xs,ys){const evidence=Array.from({length:ys.length},()=>[]),vals=Array.from({length:ys.length},()=>[]);for(let r=0;r<ys.length;r++)for(let c=0;c<xs.length;c++){const[d,t,m]=bubbleMetrics(gray,xs[c],ys[r],Math.max(3,Math.round(5.5*W/TEMPLATE_W)),Math.max(5,Math.round(13.5*W/TEMPLATE_W)),Math.max(7,Math.round(18.5*W/TEMPLATE_W)));vals[r][c]=d;evidence[r][c]=markEvidence(d,t,m,true);}return{evidence,vals};}
function detectSecondaryMarkers(warped){const gray=new cv.Mat(),bw=new cv.Mat(),contours=new cv.MatVector(),hierarchy=new cv.Mat(),found=[];try{cv.cvtColor(warped,gray,cv.COLOR_RGBA2GRAY);cv.adaptiveThreshold(gray,bw,255,cv.ADAPTIVE_THRESH_GAUSSIAN_C,cv.THRESH_BINARY_INV,31,8);cv.findContours(bw,contours,hierarchy,cv.RETR_LIST,cv.CHAIN_APPROX_SIMPLE);for(let i=0;i<contours.size();i++){const c=contours.get(i),area=cv.contourArea(c);if(area<18||area>1500){c.delete();continue;}const peri=cv.arcLength(c,true),ap=new cv.Mat();cv.approxPolyDP(c,ap,0.08*peri,true);if(ap.rows===4&&cv.isContourConvex(ap)){const r=cv.boundingRect(ap),ratio=Math.max(r.width,r.height)/Math.max(1,Math.min(r.width,r.height)),fill=area/Math.max(1,r.width*r.height),m=cv.moments(c);if(Math.min(r.width,r.height)>=4&&ratio<=1.45&&fill>=0.55&&fill<=1.15&&Math.abs(m.m00)>1e-6)found.push([m.m10/m.m00,m.m01/m.m00]);}ap.delete();c.delete();}return found;}finally{gray.delete();bw.delete();contours.delete();hierarchy.delete();}}
function refineAnswerRows(warped){const markers=detectSecondaryMarkers(warped),ys=[...ANSWER_Y];let matched=0;for(let r=0;r<ys.length;r++){const y=ANSWER_Y[r],cand=markers.filter(([mx,my])=>ANSWER_MARKER_X.some(ex=>Math.abs(mx-ex)<X(11))&&Math.abs(my-y)<Y(14)).sort((a,b)=>(Math.abs(a[1]-y)+Math.min(...ANSWER_MARKER_X.map(ex=>Math.abs(a[0]-ex)))*0.05)-(Math.abs(b[1]-y)+Math.min(...ANSWER_MARKER_X.map(ex=>Math.abs(b[0]-ex)))*0.05));if(cand.length&&Math.abs(cand[0][1]-y)<=Y(8)){ys[r]=0.75*y+0.25*cand[0][1];matched++;}}return{ys,detected:markers.length,matched};}function markEvidence(darkness,darkFraction,coreMean,digitGrid=false){return digitGrid?darkness>=24&&coreMean<=180:darkFraction>=0.30&&coreMean<=180;}
function bubbleMetrics(gray,x,y,coreR=Math.max(4,Math.round(8*W/TEMPLATE_W)),ann1=Math.max(coreR+2,Math.round(13.5*W/TEMPLATE_W)),ann2=Math.max(ann1+2,Math.round(18.5*W/TEMPLATE_W))){const ix=Math.round(x),iy=Math.round(y),h=gray.rows,w=gray.cols;let cs=0,cn=0,as=0,an=0,dark=0;for(let yy=Math.max(0,iy-ann2);yy<=Math.min(h-1,iy+ann2);yy++)for(let xx=Math.max(0,ix-ann2);xx<=Math.min(w-1,ix+ann2);xx++){const d2=(xx-ix)**2+(yy-iy)**2,v=gray.ucharPtr(yy,xx)[0];if(d2<=coreR**2){cs+=v;cn++;if(v<125)dark++;}else if(d2>=ann1**2&&d2<=ann2**2){as+=v;an++;}}if(!cn||!an)return[0,0,255];const mean=cs/cn;return[as/an-mean,dark/cn,mean];}
function readDigits(gray){const vals=Array.from({length:10},()=>[]),scores=Array.from({length:10},()=>[]);for(let r=0;r<10;r++)for(let c=0;c<2;c++){const [d,t,m]=bubbleMetrics(gray,EXAM_X[c],SID_Y[r],Math.max(3,Math.round(5.5*W/TEMPLATE_W)),Math.max(5,Math.round(13.5*W/TEMPLATE_W)),Math.max(7,Math.round(18.5*W/TEMPLATE_W)));scores[r][c]=d;vals[r][c]=markEvidence(d,t,m,true);}const out=[];for(let c=0;c<2;c++){const marked=Array.from({length:10},(_,r)=>r).filter(r=>vals[r][c]);if(!marked.length){out.push('');continue;}marked.sort((a,b)=>scores[b][c]-scores[a][c]);if(marked.length>1&&scores[marked[1]][c]>=12&&scores[marked[0]][c]-scores[marked[1]][c]<4)out.push('?');else out.push(String(marked[0]));}return{sid:out.join(''),exam:out.join('')};}
function answerBoxes(gray,numQuestions=NQ,rowY=ANSWER_Y){if(!Number.isInteger(numQuestions)||numQuestions<1||numQuestions>60)throw new Error('Số câu phải nằm trong khoảng 1–60.');const answers=[],scores=[],status=[];for(let q=0;q<numQuestions;q++){const panel=Math.floor(q/15),row=q%15,y=rowY[row],sc=[],marked=[];for(let a=0;a<4;a++){const[d,t,m]=bubbleMetrics(gray,ANSWER_X[panel][a],y);sc[a]=d;if(markEvidence(d,t,m))marked.push(a);}scores.push(sc);if(!marked.length){answers.push('');status.push('BO_TRONG');}else if(marked.length>1){const strong=marked.filter(a=>sc[a]>=12);if(strong.length>1){answers.push('?');status.push('TO_2_HOAC_NHIEU');}else{marked.sort((a,b)=>sc[b]-sc[a]);answers.push(CHOICES[marked[0]]);status.push('OK_NHAT');}}else{answers.push(CHOICES[marked[0]]);status.push(sc[marked[0]]>=12?'OK':'OK_NHAT');}}return{answers,scores,status};}function outlineReport(warped) {
    const candidates=clusterSquareCandidates(squareCandidates(warped), Math.min(warped.cols, warped.rows)).filter(c=>c.fill<=0.30&&c.ring_dark>=0&&c.size>=14);
    let matched=0, used=new Set();
    for(const target of OUTLINE_MARKER_DST) {
        let bi=-1, bd=Infinity;
        candidates.forEach((c, i)=> {
            if(used.has(i))return; const d=dist(c.center, target); if(d<28&&d<bd) {
                bi=i; bd=d;
            }
        });
        if(bi>=0) {
            used.add(bi);
            matched++;
        }
    }
    return {
        count: matched, expected: 8, raw: candidates.length
    };
}
function drawSourceDebug(srcImg, marker) {
      const canvas=$('sourceDebugCanvas');
     if(!canvas)return;
      const scale=Math.min(800/srcImg.cols, 500/srcImg.rows);
      canvas.width=Math.round(srcImg.cols*scale);
      canvas.height=Math.round(srcImg.rows*scale);
      try {
        cv.imshow(canvas, srcImg);
    } catch(e) {
        console.warn('source debug image:', e);
        return;
    }
      const ctx=canvas.getContext('2d');
     ctx.save();
     ctx.scale(scale, scale);
      ctx.lineWidth=Math.max(3, 4/scale);
     ctx.strokeStyle='#ff8c00';
     ctx.fillStyle='#ff8c00';
      marker.forEach((p, i)=> {
            const x=Number(p[0]), y=Number(p[1]);
            ctx.beginPath(); ctx.arc(x, y, 14/scale, 0, Math.PI*2); ctx.stroke();
            ctx.font=`${22/scale}px sans-serif`; ctx.fillText(['TL', 'TR', 'BR', 'BL'][i]||String(i+1), x+18/scale, y-18/scale);
         
    });
      ctx.restore();
}
function drawDebug(warped,marker,sid,exam,answers,rowY=ANSWER_Y){const canvas=$('debugCanvas');if(!canvas)throw new Error('Không tìm thấy vùng canvas để hiển thị ảnh đã chấm.');canvas.width=800;canvas.height=Math.round(800*H/W);cv.imshow(canvas,warped);const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Trình duyệt không tạo được canvas 2D.');ctx.save();try{ctx.scale(canvas.width/W,canvas.height/H);ctx.lineWidth=5;ctx.strokeStyle='#ff8c00';ctx.fillStyle='#ff8c00';MARKER_DST.forEach((p,i)=>{ctx.beginPath();ctx.arc(p[0],p[1],18,0,Math.PI*2);ctx.stroke();ctx.font='30px sans-serif';ctx.fillText(['TL','TR','BR','BL'][i],p[0]+20,p[1]-18);});ctx.strokeStyle='#007aff';ctx.fillStyle='#007aff';ctx.font='23px sans-serif';for(let q=0;q<answers.length;q++){const panel=Math.floor(q/15),row=q%15,y=rowY[row];for(let a=0;a<4;a++){const x=ANSWER_X[panel][a];ctx.beginPath();ctx.arc(x,y,Math.max(10,Math.round(8*W/TEMPLATE_W)),0,Math.PI*2);ctx.stroke();}ctx.fillText(`${q+1}:${answers[q]||'-'}`,ANSWER_X[panel][0]-30,y-20);}ctx.fillStyle='#d00';ctx.font='28px sans-serif';ctx.fillText(`SV:${sid||'-'} DE:${exam||'-'}`,30,55);}finally{ctx.restore();}}const CONFIG_KEY='omr_config_v3';
let answerKeys={}, versionCodes=['01'], versionKeys={'1':Array(60).fill('')}, pendingImport=null;
function defaultExamCode(index){return String(index+1).padStart(2,'0');}
function syncAnswerKeysByCode(){answerKeys={};for(let i=0;i<versionCodes.length;i++){const code=String(versionCodes[i]||'').trim();if(code)answerKeys[code]=versionKeys[String(i+1)]||Array(60).fill('');}}
function loadConfig(){try{const v=JSON.parse(localStorage.getItem(CONFIG_KEY)||'{}');if(v.questionCount)$('questionCount').value=v.questionCount;if(v.maxScore)$('maxScore').value=v.maxScore;if(v.versionCount)$('versionCount').value=v.versionCount;const n=Math.max(1,Math.min(99,Number($('versionCount').value)||1));versionCodes=Array.isArray(v.versionCodes)?v.versionCodes.map(String):Array.from({length:n},(_,i)=>defaultExamCode(i));versionCodes=Array.from({length:n},(_,i)=>versionCodes[i]!==undefined?versionCodes[i]:defaultExamCode(i));versionKeys={};for(let i=0;i<n;i++){const idx=String(i+1),oldCode=String(versionCodes[i]),oldKey=v.versionKeys?.[idx]||v.answerKeys?.[oldCode]||v.answerKeys?.[defaultExamCode(i)]||[];versionKeys[idx]=Array.from({length:60},(_,q)=>CHOICES.includes(oldKey[q])?oldKey[q]:'');}}catch{versionCodes=['01'];versionKeys={'1':Array(60).fill('')};}syncAnswerKeysByCode();renderAnswerKeys();}
function updateImportVisibility(){const panel=$('importPanel');if(panel)panel.classList.toggle('hidden',(Number($('versionCount').value)||1)<3);}
function renderAnswerKeys(){const n=Math.max(1,Math.min(99,parseInt($('versionCount')?.value,10)||1)),box=$('answerKeys');if(!box)return;while(versionCodes.length<n)versionCodes.push(defaultExamCode(versionCodes.length));versionCodes.length=n;for(let i=1;i<=n;i++)if(!versionKeys[String(i)])versionKeys[String(i)]=Array(60).fill('');for(const k of Object.keys(versionKeys))if(Number(k)>n)delete versionKeys[k];box.innerHTML='';for(let v=1;v<=n;v++){const idx=String(v),code=String(versionCodes[v-1]||''),sec=document.createElement('details');sec.open=v===1;sec.innerHTML=`<summary>Version ${v} · mã <span class="version-code-label">${escapeHtml(code||'__')}</span></summary><div class="version-code-wrap"><label>Mã đề (2 chữ số)<input class="version-code-input" type="text" inputmode="numeric" maxlength="2" value="${escapeHtml(code)}" data-version="${v}" aria-label="Mã đề Version ${v}"></label></div><div class="result-grid key-grid"></div>`;const codeInput=sec.querySelector('.version-code-input');codeInput.addEventListener('input',()=>{versionCodes[v-1]=codeInput.value.trim();sec.querySelector('.version-code-label').textContent=versionCodes[v-1]||'__';syncAnswerKeysByCode();persistConfig();});const grid=sec.querySelector('.key-grid');for(let q=0;q<60;q++){const label=document.createElement('label');label.textContent=`Câu ${q+1}`;const sel=document.createElement('select');sel.dataset.version=idx;sel.dataset.question=q;sel.innerHTML='<option value="">—</option>'+CHOICES.map(c=>`<option>${c}</option>`).join('');sel.value=versionKeys[idx][q]||'';sel.addEventListener('change',()=>{versionKeys[idx][q]=sel.value;syncAnswerKeysByCode();persistConfig();});label.appendChild(sel);grid.appendChild(label);}box.appendChild(sec);}syncAnswerKeysByCode();updateImportVisibility();persistConfig();}
function resetExamConfiguration(){const warning='Bạn có chắc muốn xóa toàn bộ mã đề và đáp án hiện có không? Thao tác này sẽ xóa vĩnh viễn cấu hình đề thi hiện tại và không thể hoàn tác trừ khi bạn đã lưu dữ liệu ở nơi khác.';if(!confirm(warning))return false;$('versionCount').value='1';versionCodes=[defaultExamCode(0)];versionKeys={'1':Array(60).fill('')};pendingImport=null;const file=$('importFile');if(file)file.value='';const preview=$('importPreview');if(preview){preview.replaceChildren();preview.classList.add('hidden');}const apply=$('importApplyBtn');if(apply)apply.classList.add('hidden');const importStatus=$('importStatus');if(importStatus)importStatus.textContent='';renderAnswerKeys();$('settingsStatus').textContent='Đã đặt lại cấu hình: còn 1 mã đề 01 và toàn bộ đáp án đã được xóa.';return true;}
function getCurrentExamConfigSnapshot(){return{questionCount:Number($('questionCount')?.value)||NQ,maxScore:Number($('maxScore')?.value)||MAX_SCORE,versionCount:Number($('versionCount')?.value)||versionCodes.length,versionCodes:[...versionCodes],versionKeys:JSON.parse(JSON.stringify(versionKeys)),answerKeys:JSON.parse(JSON.stringify(answerKeys))};}
function persistConfig(){if(!$('questionCount'))return;try{syncAnswerKeysByCode();const snapshot=getCurrentExamConfigSnapshot();localStorage.setItem(CONFIG_KEY,JSON.stringify(snapshot));if(currentUser&&window.OmrCloud?.isConfigured()){clearTimeout(cloudConfigSaveTimer);cloudConfigSaveTimer=setTimeout(()=>window.OmrCloud.saveConfig(snapshot).then(()=>{if($('historySyncStatus'))$('historySyncStatus').textContent='Cấu hình đề đã đồng bộ với tài khoản.';}).catch(error=>{if($('historySyncStatus')){$('historySyncStatus').textContent=`Không đồng bộ được cấu hình đề: ${error.message||error}`;$('historySyncStatus').classList.add('error');}}),500);}}catch(e){console.warn('Không lưu được cấu hình:',e);}}
function applyExamConfigSnapshot(snapshot){const value=snapshot&&typeof snapshot==='object'?snapshot:{questionCount:60,maxScore:10,versionCount:1,versionCodes:['01'],versionKeys:{'1':Array(60).fill('')}};try{localStorage.setItem(CONFIG_KEY,JSON.stringify(value));if($('questionCount'))$('questionCount').value=String(value.questionCount||60);if($('maxScore'))$('maxScore').value=String(value.maxScore||10);if($('versionCount'))$('versionCount').value=String(value.versionCount||1);loadConfig();validateConfigForLoad();}catch(error){console.warn('[OMR config] Không thể áp dụng cấu hình tài khoản:',error);}}
function validateConfigForLoad(){try{syncAnswerKeysByCode();NQ=Number($('questionCount').value)||60;MAX_SCORE=Number($('maxScore').value)||10;}catch{}}
let authTransitionId=0,accountLoadingUserId=null;
function setAuthMessage(message,isError=false){const node=$('authStatus');if(node){node.textContent=message||'';node.classList.toggle('error',Boolean(isError));}}
function updateAccountUi(user){currentUser=user||null;const label=$('accountLabel'),open=$('authOpenBtn'),out=$('signOutBtn');if(label)label.textContent=currentUser?`Đang đăng nhập: ${currentUser.email||'Tài khoản Google'} · dữ liệu đồng bộ`:(window.OmrCloud?.isConfigured()?'Chưa đăng nhập · lịch sử lưu trên thiết bị; đăng nhập để đồng bộ':'Chưa cấu hình đồng bộ · dữ liệu chỉ lưu trên thiết bị');if(open)open.classList.toggle('hidden',Boolean(currentUser));if(out)out.classList.toggle('hidden',!currentUser);}
async function handleAccountSession(session){const user=session?.user||null;if(user?.id===currentUser?.id&&user&&(accountDataReady||accountLoadingUserId===user.id))return;const transition=++authTransitionId;if($('historyDetailDialog')?.open)$('historyDetailDialog').close();updateAccountUi(user);accountDataReady=false;accountLoadingUserId=user?.id||null;historyPage=0;historyRowsCache=[];historyTotal=0;cloudHistoryEnabled=Boolean(user);if(!user){accountLoadingUserId=null;if($('historyDetailDialog')?.open)$('historyDetailDialog').close();try{const backup=localStorage.getItem('omr_guest_config_backup_v1');if(backup)applyExamConfigSnapshot(JSON.parse(backup));}catch(error){console.warn('[OMR config] Không thể khôi phục cấu hình cục bộ.');}await refreshHistory(0);return;}setAuthMessage(`Đã đăng nhập ${user.email||''}. Đang tải cấu hình và lịch sử…`);try{const localConfig=getCurrentExamConfigSnapshot();if(!localStorage.getItem('omr_guest_config_backup_v1'))localStorage.setItem('omr_guest_config_backup_v1',JSON.stringify(localConfig));let config=await window.OmrCloud.loadConfig();if(transition!==authTransitionId)return;if(!config){const copyDeviceConfig=confirm('Tài khoản này chưa có cấu hình đề. Bạn có muốn sao chép mã đề và đáp án đang có trên thiết bị vào tài khoản này không? Chọn Hủy để bắt đầu với cấu hình trống.');config=copyDeviceConfig?localConfig:{questionCount:60,maxScore:10,versionCount:1,versionCodes:['01'],versionKeys:{'1':Array(60).fill('')}};await window.OmrCloud.saveConfig(config);}applyExamConfigSnapshot(config);const sync=await window.OmrCloud.retryPending();if(transition!==authTransitionId)return;accountDataReady=true;accountLoadingUserId=null;if(sync.failed){$('historySyncStatus').textContent=`Có ${sync.failed} bản ghi đang chờ mạng để đồng bộ; sẽ tự thử lại.`;$('historyRetryBtn').classList.remove('hidden');}else{ $('historyRetryBtn').classList.add('hidden');if(sync.synced)$('historySyncStatus').textContent=`Đã đồng bộ ${sync.synced} bản ghi đang chờ.`;}setAuthMessage('Tài khoản đã sẵn sàng.');$('authDialog').close();await refreshHistory(0);}catch(error){if(transition!==authTransitionId)return;accountDataReady=false;accountLoadingUserId=null;setAuthMessage(`Không tải được dữ liệu tài khoản: ${error.message||error}`,true);$('historySyncStatus').textContent=`Lỗi tải dữ liệu: ${error.message||error}`;$('historySyncStatus').classList.add('error');await refreshHistory(0);}}
async function initializeAccountFeatures(){const cloud=window.OmrCloud;if(!cloud?.isConfigured()){updateAccountUi(null);setAuthMessage('Cần điền Supabase URL và anon key trong backend-config.js, sau đó chạy supabase_setup.sql và triển khai trang qua HTTPS.');renderHistory();return;}try{const listener=cloud.onAuthStateChange((event,session)=>{queueMicrotask(()=>{void handleAccountSession(session);if(event==='PASSWORD_RECOVERY')setTimeout(()=>{const dialog=$('passwordRecoveryDialog');if(dialog&&!dialog.open)dialog.showModal();},0);});});void listener;const result=await cloud.getSession();await handleAccountSession(result.data?.session||null);}catch(error){setAuthMessage(`Không khởi tạo được dịch vụ tài khoản: ${error.message||error}`,true);renderHistory();}}
function normalizedAuthEmail(){return String($('authEmail')?.value||'').trim().toLowerCase();}
function authRedirectTo(){return ['http:','https:'].includes(window.location.protocol)?`${window.location.origin}${window.location.pathname}`:undefined;}
function authErrorMessage(error,operation){
  const code=String(error?.code||error?.error_code||'').toLowerCase();
  const message=String(error?.message||'').toLowerCase();
  if(code.includes('email_not_confirmed')||message.includes('email not confirmed'))return 'Email này chưa được xác nhận. Hãy mở liên kết xác nhận trong thư hoặc bấm “Gửi lại email xác nhận”.';
  if(code.includes('invalid_credentials')||message.includes('invalid login credentials'))return 'Email hoặc mật khẩu chưa đúng. Nếu quên mật khẩu, chọn “Quên mật khẩu?”.';
  if(code.includes('user_already_exists')||message.includes('already registered'))return 'Email này đã được đăng ký. Hãy đăng nhập hoặc chọn “Quên mật khẩu?”; không cần tạo tài khoản lần nữa.';
  if(Number(error?.status)===429||code.includes('rate_limit'))return 'Bạn thao tác quá nhiều lần. Hãy đợi một lúc rồi thử lại.';
  if(/failed to fetch|network|load failed|connection/i.test(message))return 'Không kết nối được dịch vụ xác thực. Kiểm tra mạng rồi thử lại.';
  if(operation==='signup')return error?.message||'Không tạo được tài khoản. Hãy kiểm tra thông tin rồi thử lại.';
  return error?.message||'Không thể hoàn tất xác thực. Hãy thử lại.';
}
function bindAccountControls(){
    $('authOpenBtn')?.addEventListener('click',()=>{setAuthMessage(window.OmrCloud?.isConfigured()?'':'Cần cấu hình dịch vụ Supabase trước khi đăng nhập.',!window.OmrCloud?.isConfigured());$('authDialog').showModal();});
    $('authCloseBtn')?.addEventListener('click',()=>$('authDialog').close());
    $('authForm')?.addEventListener('submit',async event=>{
      event.preventDefault();if(!window.OmrCloud?.isConfigured()){setAuthMessage('Chưa cấu hình Supabase. Xem backend-config.js và hướng dẫn SETUP_AUTH.md.',true);return;}
      const email=normalizedAuthEmail(),password=$('authPassword').value; if(!email)return;
      setAuthMessage('Đang đăng nhập…');
      try{const {error}=await window.OmrCloud.signIn(email,password);if(error)throw error;setAuthMessage('Đăng nhập thành công. Đang tải dữ liệu tài khoản…');}
      catch(error){if(String(error?.code||error?.error_code||'').toLowerCase().includes('email_not_confirmed')||String(error?.message||'').toLowerCase().includes('email not confirmed')){window.pendingConfirmationEmail=email;$('authResendConfirmBtn')?.classList.remove('hidden');}setAuthMessage(authErrorMessage(error,'login'),true);}
    });
    $('signUpBtn')?.addEventListener('click',async()=>{
      if(!window.OmrCloud?.isConfigured()){setAuthMessage('Chưa cấu hình Supabase. Xem backend-config.js và hướng dẫn SETUP_AUTH.md.',true);return;}
      const email=normalizedAuthEmail(),password=$('authPassword').value;
      if(!$('authEmail').reportValidity()||!email)return;
      if(!$('authPassword').reportValidity())return;
      setAuthMessage('Đang tạo tài khoản…');
      try{
        const {data,error}=await window.OmrCloud.signUp(email,password,{redirectTo:authRedirectTo()});
        if(error)throw error;
        if(Array.isArray(data?.user?.identities)&&data.user.identities.length===0){
          window.pendingConfirmationEmail=email;$('authResendConfirmBtn')?.classList.remove('hidden');
          setAuthMessage('Email này đã được đăng ký. Hãy đăng nhập hoặc dùng “Quên mật khẩu?”. Nếu đang chờ xác nhận, bạn có thể yêu cầu gửi lại email.');return;
        }
        if(data?.session){setAuthMessage('Tạo tài khoản thành công, đang đăng nhập…');return;}
        if(data?.user){window.pendingConfirmationEmail=email;$('authResendConfirmBtn')?.classList.remove('hidden');setAuthMessage('Supabase đã tiếp nhận yêu cầu đăng ký. Nếu xác nhận email đang bật, hãy mở thư xác nhận hoặc thư rác trước khi đăng nhập.');return;}
        setAuthMessage('Dịch vụ chưa xác nhận kết quả tạo tài khoản. Hãy thử đăng nhập hoặc kiểm tra lại sau.',true);
      }catch(error){setAuthMessage(authErrorMessage(error,'signup'),true);}
    });
    $('authResendConfirmBtn')?.addEventListener('click',async()=>{
      const email=window.pendingConfirmationEmail||normalizedAuthEmail();if(!email){setAuthMessage('Nhập email cần xác nhận trước.',true);return;}
      setAuthMessage('Đang gửi yêu cầu xác nhận lại…');
      try{const {error}=await window.OmrCloud.resendConfirmation(email,authRedirectTo());if(error)throw error;setAuthMessage('Supabase đã tiếp nhận yêu cầu gửi lại. Hãy kiểm tra hộp thư và thư rác.');}
      catch(error){setAuthMessage(authErrorMessage(error,'resend'),true);}
    });
    $('authResetPasswordBtn')?.addEventListener('click',async()=>{
      const email=normalizedAuthEmail();if(!$('authEmail').reportValidity()||!email){setAuthMessage('Nhập email hợp lệ để yêu cầu đặt lại mật khẩu.',true);$('authEmail').focus();return;}
      setAuthMessage('Đang gửi yêu cầu đặt lại mật khẩu…');
      try{const {error}=await window.OmrCloud.requestPasswordReset(email,authRedirectTo());if(error)throw error;setAuthMessage('Supabase đã tiếp nhận yêu cầu. Nếu email được đăng ký, hướng dẫn đặt lại mật khẩu sẽ được gửi; hãy kiểm tra cả thư rác.');}
      catch(error){setAuthMessage(authErrorMessage(error,'recovery'),true);}
    });
    $('passwordRecoveryForm')?.addEventListener('submit',async event=>{
      event.preventDefault();const password=$('recoveryNewPassword').value,confirmPassword=$('recoveryConfirmPassword').value;
      if(password!==confirmPassword){$('passwordRecoveryStatus').textContent='Hai mật khẩu chưa khớp.';return;}
      $('passwordRecoveryStatus').textContent='Đang cập nhật mật khẩu…';
      try{const {error}=await window.OmrCloud.updatePassword(password);if(error)throw error;$('passwordRecoveryStatus').textContent='Đã cập nhật mật khẩu. Bạn có thể tiếp tục sử dụng tài khoản.';$('passwordRecoveryForm').reset();setTimeout(()=>$('passwordRecoveryDialog').close(),900);}
      catch(error){$('passwordRecoveryStatus').textContent=authErrorMessage(error,'recovery');}
    });
    $('passwordRecoveryCloseBtn')?.addEventListener('click',()=>$('passwordRecoveryDialog').close());
    $('googleSignInBtn')?.addEventListener('click',async()=>{if(!window.OmrCloud?.isConfigured()){setAuthMessage('Chưa cấu hình Supabase và Google OAuth.',true);return;}setAuthMessage('Đang chuyển tới Google…');try{const {error}=await window.OmrCloud.signInWithGoogle(authRedirectTo());if(error)throw error;}catch(error){setAuthMessage(authErrorMessage(error,'google'),true);}});
    $('signOutBtn')?.addEventListener('click',async()=>{try{const {error}=await window.OmrCloud.signOut();if(error)throw error;setAuthMessage('Đã đăng xuất khỏi phiên này. Lịch sử tài khoản vẫn được giữ trên máy chủ.');}catch(error){setAuthMessage(authErrorMessage(error,'logout'),true);}});
    $('historyPrevBtn')?.addEventListener('click',()=>{if(historyPage>0)refreshHistory(historyPage-1);});$('historyNextBtn')?.addEventListener('click',()=>{if((historyPage+1)*historyPageSize<historyTotal)refreshHistory(historyPage+1);});
    $('historyRetryBtn')?.addEventListener('click',async()=>{if(!currentUser||!accountDataReady)return;const button=$('historyRetryBtn');button.disabled=true;$('historySyncStatus').textContent='Đang thử đồng bộ các bản ghi đang chờ…';try{const result=await window.OmrCloud.retryPending();$('historySyncStatus').textContent=result.failed?`Còn ${result.failed} bản ghi chưa đồng bộ; hãy kiểm tra kết nối.`:`Đã đồng bộ ${result.synced} bản ghi.`;$('historySyncStatus').classList.toggle('error',Boolean(result.failed));button.classList.toggle('hidden',!result.failed);await refreshHistory(historyPage);}catch(error){$('historySyncStatus').textContent=`Đồng bộ thất bại: ${error.message||error}`;$('historySyncStatus').classList.add('error');}finally{button.disabled=false;}});
    $('historyDetailCloseBtn')?.addEventListener('click',()=>$('historyDetailDialog').close());$('historyDetailDialog')?.addEventListener('close',()=>{if(historyImageObjectUrl){URL.revokeObjectURL(historyImageObjectUrl);historyImageObjectUrl=null;}});
    window.addEventListener('online',()=>{if(currentUser&&window.OmrCloud?.isConfigured())window.OmrCloud.retryPending().then(()=>refreshHistory(historyPage)).catch(()=>{});});
}
function validateConfig(){const q=Number($('questionCount').value),max=Number($('maxScore').value),n=Number($('versionCount').value);if(!Number.isInteger(q)||q<1||q>60)throw Error('Số câu phải từ 1 đến 60.');if(!Number.isFinite(max)||max<=0)throw Error('Điểm tối đa phải là số lớn hơn 0.');if(!Number.isInteger(n)||n<1||n>99)throw Error('Số mã đề phải từ 1 đến 99.');const seen=new Set();let active=0;for(let v=1;v<=n;v++){const code=String(versionCodes[v-1]||'').trim(),key=versionKeys[String(v)]||[],hasAnswers=key.some(a=>CHOICES.includes(a));if(!code&&!hasAnswers)continue;if(!validExamCode(code))throw Error(`Mã đề Version ${v} phải gồm đúng hai chữ số.`);if(seen.has(code))throw Error(`Mã đề ${code} đang bị trùng. Mỗi mã đề phải duy nhất.`);seen.add(code);active++;for(let i=0;i<q;i++)if(!CHOICES.includes(key[i]))throw Error(`Thiếu đáp án hợp lệ cho mã đề ${code}, câu ${i+1}.`);}if(!active)throw Error('Chưa có mã đề nào được cấu hình đầy đủ. Hãy nhập ít nhất một mã đề và đáp án trước khi chấm.');syncAnswerKeysByCode();NQ=q;MAX_SCORE=max;return{q,max,n,active};}
function importHeaderLabel(value){return String(value??'').trim().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/đ/g,'d').replace(/[\s_]+/g,' ');}
function validExamCode(code){return /^\d{2}$/.test(String(code))&&Number(code)>=1&&Number(code)<=99;}function normalizeImportedCode(value){if(typeof value==='number'&&Number.isInteger(value)&&value>=0&&value<=99)return String(value).padStart(2,'0');const s=String(value??'').trim();return /^\d{1,2}$/.test(s)?s.padStart(2,'0'):s;}
function limitImportEntries(entries,warnings=[]){const configured=Math.max(1,Number($('versionCount').value)||1),selected=entries.slice(0,configured);selected.importSummary={configured,detected:entries.length,imported:selected.length,warnings};return selected;}
function parseImportGrid(rows){if(!Array.isArray(rows)||!rows.length)throw Error('Tệp không có bảng dữ liệu.');const header=rows[0].map(importHeaderLabel),codeCol=header.findIndex(x=>['exam code','examcode','code','ma de'].includes(x));if(codeCol<0)throw Error('Không tìm thấy cột Exam Code (hoặc Mã đề) ở dòng đầu bảng.');const questionCol=header.findIndex(x=>['question','question number','cau','so cau'].includes(x)),answerCol=header.findIndex(x=>['answer','correct answer','dap an','dap an dung'].includes(x));if(questionCol>=0||answerCol>=0){if(questionCol<0||answerCol<0||questionCol===codeCol||answerCol===codeCol||questionCol===answerCol)throw Error('Bảng dạng Word cần có các cột Exam Code, Question và Correct Answer.');for(let c=0;c<header.length;c++)if(header[c]&&c!==codeCol&&c!==questionCol&&c!==answerCol)throw Error('Cột không hợp lệ trong bảng: '+rows[0][c]);const groups=new Map();for(let r=1;r<rows.length;r++){const row=rows[r]||[];if(row.every(v=>String(v??'').trim()===''))continue;const code=normalizeImportedCode(row[codeCol]),qText=String(row[questionCol]??'').trim(),qm=qText.match(/^(?:q|question|cau)?\s*0*(\d{1,2})$/i),answer=String(row[answerCol]??'').trim().toUpperCase();if(!validExamCode(code))throw Error(`Mã đề ở dòng ${r+1} phải gồm một hoặc hai chữ số.`);if(!qm||Number(qm[1])<1||Number(qm[1])>60)throw Error(`Nhãn câu hỏi không hợp lệ ở dòng ${r+1}: ${qText}`);const q=Number(qm[1]);if(answer&&!CHOICES.includes(answer))throw Error(`Đáp án ở dòng ${r+1}, Q${q} không hợp lệ: ${answer}`);if(!groups.has(code))groups.set(code,Array(60).fill(''));const key=groups.get(code);if(key[q-1])throw Error(`Mã đề ${code} có câu Q${q} bị lặp.`);key[q-1]=answer;}const entries=Array.from(groups,([code,answers])=>({code,answers}));return limitImportEntries(entries);}const qCols=new Map(),headerWarnings=[];for(let c=0;c<header.length;c++){const alias=header[c]==='a57'&&c===57,m=header[c].match(/^(?:q|question|cau)\s*0*(\d{1,2})$/);if(m||alias){const q=alias?57:Number(m[1]);if(alias)headerWarnings.push('Tiêu đề “A57” ở cột thứ 58 được hiểu là Q57; hãy xác nhận nội dung ở phần xem trước.');if(q<1||q>60)throw Error(`Nhãn câu hỏi không hợp lệ: ${rows[0][c]}`);if(qCols.has(q))throw Error(`Nhãn Q${q} bị lặp.`);qCols.set(q,c);}else if(c!==codeCol&&header[c])throw Error(`Cột không hợp lệ trong bảng: ${rows[0][c]}`);}for(let q=1;q<=NQ;q++)if(!qCols.has(q))throw Error(`Thiếu cột Q${q} trong bảng.`);const entries=[];for(let r=1;r<rows.length;r++){const row=rows[r]||[];if(row.every(v=>String(v??'').trim()===''))continue;const code=normalizeImportedCode(row[codeCol]);if(!validExamCode(code))throw Error(`Mã đề ở dòng ${r+1} phải gồm một hoặc hai chữ số (ví dụ 01).`);const answers=Array(60).fill('');for(const [q,c] of qCols){const answer=String(row[c]??'').trim().toUpperCase();if(answer&&!CHOICES.includes(answer))throw Error(`Đáp án tại dòng ${r+1}, Q${q} không hợp lệ: ${answer}`);answers[q-1]=answer;}entries.push({code,answers});}const seen=new Set();for(const e of entries){if(seen.has(e.code))throw Error(`Mã đề ${e.code} bị trùng trong tệp.`);seen.add(e.code);}return limitImportEntries(entries,headerWarnings);}function excelCellValue(ws,r,c){const cell=ws[XLSX.utils.encode_cell({r,c})];if(!cell)return '';if(cell.t==='n'&&Number.isInteger(cell.v))return String(cell.w||String(cell.v).padStart(2,'0'));return cell.w??cell.v??'';}
let mammothLoadPromise=null;function ensureMammoth(){if(typeof mammoth!=='undefined')return Promise.resolve();if(!mammothLoadPromise)mammothLoadPromise=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://cdn.jsdelivr.net/npm/mammoth@1.13.0/mammoth.browser.min.js';script.onload=()=>typeof mammoth!=='undefined'?resolve():reject(Error('Không khởi tạo được thư viện Word.'));script.onerror=()=>reject(Error('Không tải được thư viện đọc Word.'));document.head.appendChild(script);});return mammothLoadPromise;}async function readImportFile(file){const ext=(file.name.split('.').pop()||'').toLowerCase();let grid;if(ext==='xlsx'){if(typeof XLSX==='undefined')throw Error('Không tải được thư viện đọc Excel.');const wb=XLSX.read(await file.arrayBuffer(),{type:'array',cellNF:true});const ws=wb.Sheets[wb.SheetNames[0]];if(!ws||!ws['!ref'])throw Error('Workbook không có bảng dữ liệu.');const range=XLSX.utils.decode_range(ws['!ref']);grid=[];for(let r=range.s.r;r<=range.e.r;r++){const row=[];for(let c=range.s.c;c<=range.e.c;c++)row.push(excelCellValue(ws,r,c));grid.push(row);}}else if(ext==='docx'){await ensureMammoth();const result=await mammoth.convertToHtml({arrayBuffer:await file.arrayBuffer()});return parseDocxImport(result.value);}else throw Error('Chỉ hỗ trợ tệp .xlsx và .docx.');return parseImportGrid(grid);}
function normalizeDocxText(value){return String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').replace(/Đ/g,'D');}
function docxCodeFromText(value){const m=normalizeDocxText(value).match(/\bma\s*de\s*[:：-]?\s*(\d{1,2})\b/i);return m?m[1].padStart(2,'0'):'';}
function parseDocxImport(html){
  const parsed=new DOMParser().parseFromString(html,'text/html'),entries=[],seenCodes=new Set();let currentCode='';
  const pushVersion=(code,questions,tableIndex)=>{if(!validExamCode(code))throw Error(`Không nhận diện được mã đề hợp lệ ở bảng/trang ${tableIndex}.`);if(seenCodes.has(code))throw Error(`Mã đề ${code} bị lặp trong tài liệu Word.`);seenCodes.add(code);const answers=Array(60).fill('');for(const [q,answer] of questions){if(q<1||q>60)throw Error(`Nhãn câu hỏi ngoài phạm vi 1–60 trong mã đề ${code}: Câu ${q}.`);if(answers[q-1]!==''||questions.filter(x=>x[0]===q).length>1)throw Error(`Câu ${q} bị lặp trong mã đề ${code}.`);if(answer&&!CHOICES.includes(answer))throw Error(`Đáp án không hợp lệ ở mã đề ${code}, Câu ${q}: ${answer}.`);answers[q-1]=answer;}if(!questions.length)throw Error(`Không tìm thấy nhãn câu hỏi trong bảng/trang ${tableIndex}, mã đề ${code}.`);entries.push({code,answers});};
  const children=Array.from(parsed.body.children);let tableIndex=0;
  for(const node of children){if(node.tagName==='P'||/^H[1-6]$/.test(node.tagName)){const code=docxCodeFromText(node.innerText||node.textContent);if(code)currentCode=code;continue;}if(node.tagName!=='TABLE')continue;tableIndex++;const rows=Array.from(node.rows);if(!rows.length)continue;const allText=rows.map(r=>r.innerText||r.textContent||'').join(' '),code=docxCodeFromText(allText)||currentCode;if(!code)throw Error(`Không tìm thấy dòng “MÃ ĐỀ: xx” cho bảng/trang ${tableIndex}.`);
    const questions=[];
    for(const row of rows){const cells=Array.from(row.cells),rowText=cells.map(c=>c.innerText||c.textContent||'').join(' ');if(docxCodeFromText(rowText))continue;
      let foundLabel=false;
      for(let ci=0;ci<cells.length;ci++){const raw=String(cells[ci].innerText||cells[ci].textContent||'').trim(),norm=normalizeDocxText(raw),label=/\bcau\s*0*(\d{1,2})\b/i.exec(norm);if(!label)continue;foundLabel=true;const q=Number(label[1]);let tail=norm.slice(label.index+label[0].length).trim(),answer='';
        const same=tail.match(/^[:.)-]?\s*([A-D])\b/i);if(same)answer=same[1].toUpperCase();else if(tail&&/^[:.)-]?$/.test(tail)===false)throw Error(`Không đọc được đáp án sau Câu ${q} trong mã đề ${code}: ${raw}.`);
        if(!answer&&!tail&&ci+1<cells.length){const next=normalizeDocxText(cells[ci+1].innerText||cells[ci+1].textContent||'').trim();if(next&&!/\bcau\s*0*\d{1,2}\b/i.test(next)){const m=/^([A-D])\b/i.exec(next);if(m)answer=m[1].toUpperCase();else throw Error(`Đáp án không hợp lệ sau Câu ${q} trong mã đề ${code}: ${next}.`);}}
        questions.push([q,answer]);
      }
      if(!foundLabel&&rowText.trim()&&!docxCodeFromText(rowText)&&/\bcau\b/i.test(normalizeDocxText(rowText)))throw Error(`Không phân tích được nhãn câu hỏi trong mã đề ${code}: ${rowText.trim()}.`);
    }
    pushVersion(code,questions,tableIndex);currentCode='';
  }
  if(!entries.length)throw Error('Không tìm thấy bảng đáp án trong tài liệu Word.');
  return limitImportEntries(entries);
}
function renderImportWarnings(entries){const meta=entries.importSummary||{configured:Number($('versionCount').value)||entries.length,detected:entries.length,imported:entries.length};let summary;if(meta.detected>meta.configured)summary=`Đã phát hiện ${meta.detected} mã đề. Đã nhập ${meta.imported} mã đầu tiên theo cấu hình; bỏ qua ${meta.detected-meta.imported} mã còn lại.`;else if(meta.detected<meta.configured)summary=`Chỉ tìm thấy và nhập được ${meta.imported} trong tổng số ${meta.configured} mã đề đã cấu hình. Còn thiếu ${meta.configured-meta.imported} mã đề; bạn có thể cấu hình thủ công.`;else summary=`Đã phát hiện và nhập đủ ${meta.imported} mã đề đã cấu hình.`;const missing=[];for(const entry of entries){const qs=[];for(let i=0;i<60;i++)if(!CHOICES.includes(entry.answers[i]))qs.push(i+1);if(qs.length)missing.push(`${entry.code}: ${qs.map(q=>`Q${q}`).join(', ')}`);}const answerWarning=missing.length?` Còn câu chưa có đáp án: ${missing.join(' | ')}. Ô trống được giữ nguyên; hãy điền các câu thuộc phạm vi chấm trước khi xác nhận.`:' Kiểm tra bảng xem trước, chỉnh sửa nếu cần, rồi xác nhận nhập.';const formatWarning=meta.warnings?.length?` Lưu ý định dạng: ${meta.warnings.join(' ')}`:'';$('importStatus').textContent=summary+answerWarning+formatWarning;}
function renderImportPreview(entries){pendingImport=entries.map(e=>({code:e.code,answers:[...e.answers]}));pendingImport.importSummary=entries.importSummary||{configured:Number($('versionCount').value)||entries.length,detected:entries.length,imported:entries.length};const wrap=$('importPreview'),table=document.createElement('table');table.className='import-preview-table';const thead=document.createElement('thead'),hr=document.createElement('tr');['Mã đề',...Array.from({length:60},(_,i)=>`Q${i+1}`)].forEach(x=>{const th=document.createElement('th');th.textContent=x;hr.appendChild(th);});thead.appendChild(hr);table.appendChild(thead);const tbody=document.createElement('tbody');pendingImport.forEach((entry,ri)=>{const tr=document.createElement('tr'),codeCell=document.createElement('td'),codeInput=document.createElement('input');codeInput.value=entry.code;codeInput.maxLength=2;codeInput.inputMode='numeric';codeInput.addEventListener('input',()=>{entry.code=codeInput.value.trim();const dup=pendingImport.some((other,i)=>i!==ri&&other.code===entry.code);if(dup)$('importStatus').textContent=`Mã đề ${entry.code} bị trùng; hãy sửa mã trước khi xác nhận.`;else if(!validExamCode(entry.code))$('importStatus').textContent='Mã đề phải gồm đúng hai chữ số từ 01 đến 99.';else renderImportWarnings(pendingImport);});codeCell.appendChild(codeInput);tr.appendChild(codeCell);for(let q=0;q<60;q++){const td=document.createElement('td'),sel=document.createElement('select');sel.innerHTML='<option value="">—</option>'+CHOICES.map(c=>`<option>${c}</option>`).join('');sel.value=entry.answers[q]||'';sel.addEventListener('change',()=>{entry.answers[q]=sel.value;renderImportWarnings(pendingImport);});td.appendChild(sel);tr.appendChild(td);}tbody.appendChild(tr);});table.appendChild(tbody);wrap.replaceChildren(table);wrap.classList.remove('hidden');$('importApplyBtn').classList.remove('hidden');}
async function handleImportFile(file){$('importStatus').textContent='Đang đọc tệp…';$('importPreview').classList.add('hidden');$('importApplyBtn').classList.add('hidden');try{const q=Number($('questionCount').value);if(!Number.isInteger(q)||q<1||q>60)throw Error('Số câu phải từ 1 đến 60 trước khi nhập.');NQ=q;if(Number($('versionCount').value)<3)throw Error('Chỉ có thể nhập tệp khi cấu hình từ 3 mã đề trở lên.');pendingImport=await readImportFile(file);renderImportPreview(pendingImport);renderImportWarnings(pendingImport);}catch(e){pendingImport=null;$('importStatus').textContent=e.message||String(e);}}
function applyImportedKeys(){if(!pendingImport)return;const seen=new Set();for(let i=0;i<pendingImport.length;i++){const e=pendingImport[i];e.code=String(e.code).trim();if(!validExamCode(e.code)){$('importStatus').textContent=`Mã đề ở dòng ${i+1} phải gồm đúng hai chữ số.`;return;}if(seen.has(e.code)){$('importStatus').textContent=`Mã đề ${e.code} bị trùng.`;return;}seen.add(e.code);for(let q=0;q<NQ;q++)if(!CHOICES.includes(e.answers[q])){$('importStatus').textContent=`Thiếu đáp án hợp lệ cho mã đề ${e.code}, Q${q+1}.`;return;}}if(!confirm('Nhập dữ liệu sẽ thay thế toàn bộ mã đề và đáp án hiện có. Bạn có muốn tiếp tục?'))return;const configured=Math.max(1,Number($('versionCount').value)||1);versionCodes=Array.from({length:configured},(_,i)=>pendingImport[i]?.code||'');versionKeys={};for(let i=0;i<configured;i++){const imported=pendingImport[i];versionKeys[String(i+1)]=imported?Array.from({length:60},(_,q)=>imported.answers[q]||''):Array(60).fill('');}renderAnswerKeys();persistConfig();renderImportWarnings(pendingImport);$('importStatus').textContent+=' Đã lưu các mã và đáp án đã nhập; các phiên bản còn thiếu được để trống để cấu hình thủ công.';$('importPreview').classList.add('hidden');$('importApplyBtn').classList.add('hidden');$('importFile').value='';pendingImport=null;}function processImage(file,onComplete){const gradingUserId=currentUser?.id||null;if(currentUser&&window.OmrCloud?.isConfigured()&&!accountDataReady){$('status').textContent='Cấu hình tài khoản đang tải. Hãy thử lại sau ít giây.';if(typeof onComplete==='function')onComplete(false,{stage:'cấu hình tài khoản',message:'Cấu hình tài khoản đang tải.'});return;}if(!cvReady){$('status').textContent='Đang đợi OpenCV.js sẵn sàng trước khi xử lý ảnh…';ensureOpenCv().then(api=>{if(api)processImage(file,onComplete);else if(typeof onComplete==='function')onComplete(false,{stage:'khởi tạo OpenCV.js',message:cvInitError||'OpenCV.js chưa sẵn sàng.'});});return;}const started=performance.now(),url=URL.createObjectURL(file),img=new Image();$('status').textContent='Đang xử lý ảnh bằng OpenCV.js…';img.onload=async()=>{let mat=null,warped=null,gray=null,stage='kiểm tra cấu hình',failure=null,configValid=false,historySaved=false,succeeded=false,sid={sid:''},exam={exam:''},ans=null,key=null;try{console.info('[OMR] Bắt đầu xử lý ảnh.');validateConfig();configValid=true;console.info('[OMR] Cấu hình hợp lệ.',{questions:NQ,maxScore:MAX_SCORE,examVersionCount:Object.keys(answerKeys).length});stage='đọc ảnh camera';mat=cv.imread(img);if(!mat||mat.empty())throw new Error('OpenCV.js không đọc được ảnh.');console.info('[OMR] Kích thước ảnh gốc',{width:mat.cols,height:mat.rows});stage='tìm marker và căn chỉnh phối cảnh';const wr=warp(mat);warped=wr.warped;console.info('[OMR] Đã hiệu chỉnh phối cảnh',{width:warped.cols,height:warped.rows,primaryMarkers:wr.marker?.length,rowMarkersMatched:wr.rowReport?.matched});stage='chuẩn hóa ảnh A4';gray=new cv.Mat();cv.cvtColor(warped,gray,cv.COLOR_RGBA2GRAY);stage='đọc mã sinh viên và mã đề';sid=readSid(gray);exam=readExam(gray);console.info('[OMR] Đã nhận dạng trường mã sinh viên/mã đề.',{studentIdRecognized:/^\d{4}$/.test(sid.sid),examCodeRecognized:/^\d{2}$/.test(exam.exam)});stage='tinh chỉnh marker hàng và đọc đáp án';const rowMarkers=wr.rowReport||refineAnswerRows(warped);ans=answerBoxes(gray,NQ,rowMarkers.ys);console.info('[OMR] Đã đọc đáp án',{questions:ans.answers.length,rowMarkersDetected:rowMarkers.detected,rowMarkersMatched:rowMarkers.matched});const code=String(exam.exam||'');if(!validExamCode(code))throw new Error(`Mã đề ${exam.exam||'không nhận diện'} không hợp lệ hoặc không nhận diện được.`);key=answerKeys[code];if(!key)throw new Error(`Mã đề ${code} chưa có answer key tương ứng.`);for(let i=0;i<NQ;i++)if(!CHOICES.includes(key[i]))throw new Error(`Thiếu đáp án hợp lệ cho mã đề ${code}, câu ${i+1}.`);const correct=ans.answers.reduce((n,a,i)=>n+(a===key[i]?1:0),0),score=Math.round(correct/NQ*MAX_SCORE*100)/100,checks=ans.status.map((v,i)=>(v==='BO_TRONG'||v==='TO_2_HOAC_NHIEU')?i+1:null).filter(Boolean),incorrectQuestions=ans.answers.map((a,i)=>(a&&a!=='?'&&a!==key[i])?i+1:null).filter(Boolean),unansweredQuestions=ans.status.map((v,i)=>v==='BO_TRONG'?i+1:null).filter(Boolean),reviewDetails=[];if(!/^\d{4}$/.test(sid.sid)||sid.sid.includes('?'))reviewDetails.push('Student ID recognition failed; verify student identification');if(!/^\d{2}$/.test(exam.exam)||exam.exam.includes('?'))reviewDetails.push('Exam code recognition failed; verify exam version');for(let i=0;i<ans.status.length;i++){if(ans.status[i]==='BO_TRONG')reviewDetails.push(`Q${i+1}: no answer marked`);else if(ans.status[i]==='TO_2_HOAC_NHIEU')reviewDetails.push(`Q${i+1}: multiple options marked`);}const needsReview=reviewDetails.length>0;console.info('[OMR] Chấm điểm hoàn tất.',{needsReview});$('sid').textContent=sid.sid||'—';$('exam').textContent=exam.exam||'—';$('correct').textContent=`${correct}/${NQ}`;$('score').textContent=score.toFixed(2)+(needsReview?'*':'');$('check').textContent=needsReview?'CẦN KIỂM TRA':'OK';$('check').className=needsReview?'bad':'ok';$('checkQuestions').textContent=checks.map(i=>`C${i}`).join(', ')||'Không có';$('answers').textContent=ans.answers.map((a,i)=>`C${i+1}: ${a||'BO_TRONG'}`).join('\n');$('wrong').textContent=incorrectQuestions.map(i=>`C${i}`).join(', ')||'KHÔNG SAI';const saved=await saveHistoryRecord({student_id:sid.sid,exam_code:exam.exam,correct_text:`${correct}/${NQ}`,score,question_count:NQ,max_score:MAX_SCORE,needs_check:needsReview,check_questions:checks,recognized_answers:ans.answers,correct_answers:key.slice(0,NQ),question_status:ans.status,incorrect_questions:incorrectQuestions,unanswered_questions:unansweredQuestions,review_details:reviewDetails},file,gradingUserId);historySaved=saved!==false;$('gradedImageCard').classList.remove('hidden');const elapsed=((performance.now()-started)/1000).toFixed(2);try{drawDebug(warped,wr.marker,sid.sid,exam.exam,ans.answers,rowMarkers.ys);$('status').textContent=(historySaved?(currentUser&&currentUser.id===gradingUserId?'Đã chấm; đang lưu vào tài khoản…':'Hoàn thành và đã lưu lịch sử trên thiết bị.'):'Đã chấm; không thể lưu lịch sử vào bộ nhớ trình duyệt.')+` (${elapsed} giây)`;console.info(`OMR processing completed in ${elapsed}s`);}catch(renderError){console.error('Không hiển thị được ảnh đã chấm:',renderError);$('status').textContent='Đã chấm'+(historySaved?' và đã lưu lịch sử':'')+'; không thể vẽ ảnh đánh dấu: '+(renderError.message||renderError);}succeeded=true;}catch(e){const message=e?.message||String(e);failure={stage,message};$('status').textContent=`Lỗi tại bước ${stage}: ${message}`;console.error(`[OMR] Thất bại tại bước ${stage}.`,e?.name||'Error');if(configValid&&!historySaved){const msg=`${stage}: ${e.message||e}`;historySaved=await saveHistoryRecord({student_id:sid.sid,exam_code:exam.exam,question_count:NQ,max_score:MAX_SCORE,needs_check:true,recognized_answers:ans?.answers||[],correct_answers:key||[],question_status:ans?.status||[],review_details:[msg],processing_error:msg},file,gradingUserId)!==false;}}finally{if(gray)gray.delete();if(warped)warped.delete();if(mat)mat.delete();URL.revokeObjectURL(url);if(typeof onComplete==='function')onComplete(succeeded,failure);}};img.onerror=()=>{const failure={stage:'đọc ảnh camera',message:'Trình duyệt không giải mã được ảnh chụp từ camera.'};$('status').textContent=`Lỗi tại bước ${failure.stage}: ${failure.message}`;console.error('[OMR] Không giải mã được ảnh camera.',failure);URL.revokeObjectURL(url);if(typeof onComplete==='function')onComplete(false,failure);};img.src=url;}
let cameraStream=null,cameraActive=false,cameraTriggered=false,cameraWaitingForClear=false,cameraClearFrames=0,cameraDetections=[],cameraMissFrames=0,cameraTimer=null,cameraScanBusy=false;
function scheduleCameraScan(delay=300){clearTimeout(cameraTimer);if(cameraActive)cameraTimer=setTimeout(scanCameraFrame,delay);}
function stableCameraQuad(a,b,w,h){if(!a||!b||a.length!==4||b.length!==4)return false;for(let i=0;i<4;i++)if(Math.hypot((a[i][0]-b[i][0])/Math.max(1,w),(a[i][1]-b[i][1])/Math.max(1,h))>0.055)return false;return true;}
function fitCameraPreview(){const video=$('cameraVideo'),wrap=$('cameraPreview');if(!video||!wrap||!video.videoWidth||!video.videoHeight)return;const aspect=video.videoWidth/video.videoHeight,mobile=window.matchMedia('(max-width:620px)').matches,availableHeight=Math.max(220,window.innerHeight-(mobile?300:330)),availableWidth=Math.max(1,(wrap.parentElement?.clientWidth||window.innerWidth-40)),width=Math.max(1,Math.min(availableWidth,availableHeight*aspect));wrap.style.width=`${Math.round(width)}px`;wrap.style.height=`${Math.round(width/aspect)}px`;wrap.style.aspectRatio=`${video.videoWidth} / ${video.videoHeight}`;}
function scanCameraFrame(){if(!cameraActive)return;if(cameraScanBusy||!cvReady||$('cameraVideo').readyState<2){scheduleCameraScan(350);return;}if(cameraTriggered){scheduleCameraScan(350);return;}cameraScanBusy=true;let frame=null;try{const video=$('cameraVideo'),maxSide=800,scale=Math.min(1,maxSide/Math.max(video.videoWidth,video.videoHeight)),w=Math.max(1,Math.round(video.videoWidth*scale)),h=Math.max(1,Math.round(video.videoHeight*scale)),canvas=$('cameraScanCanvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});canvas.width=w;canvas.height=h;if(!ctx)throw Error('Không tạo được khung phân tích camera.');ctx.drawImage(video,0,0,w,h);frame=cv.imread(canvas);let marker=null;try{marker=findBlackMarkerPage(frame);}catch(error){marker=null;}
 if(cameraWaitingForClear){if(!marker||marker.length!==4){cameraClearFrames++;if(cameraClearFrames>=5){cameraWaitingForClear=false;cameraTriggered=false;cameraDetections=[];cameraMissFrames=0;$('cameraStatus').textContent='Phiếu cũ đã rời khung hình. Đưa phiếu mới vào, camera đang tiếp tục quét.';$('cameraNextBtn').classList.add('hidden');}}else{cameraClearFrames=0;$('cameraStatus').textContent='Đang chờ lấy phiếu vừa chấm ra khỏi khung để tránh chấm trùng.';}}
 else if(marker&&marker.length===4){cameraMissFrames=0;const now=performance.now();cameraDetections=cameraDetections.filter(d=>now-d.at<1800);const reference=cameraDetections.length?cameraDetections[Math.floor(cameraDetections.length/2)].quad:null;if(!reference||!stableCameraQuad(reference,marker,w,h))cameraDetections=[];cameraDetections.push({quad:marker,at:now});cameraDetections=cameraDetections.slice(-5);$('cameraState').classList.add('camera-ready');if(cameraDetections.length>=4){cameraTriggered=true;$('cameraState').classList.add('camera-ready');$('cameraStatus').textContent='Đã xác nhận đủ bốn marker ổn định. Đang chụp và chấm tự động…';captureLiveFrame();}else $('cameraStatus').textContent=`Đã nhận đủ bốn marker (${cameraDetections.length}/4 lần xác nhận). Giữ phiếu trong vùng camera.`;}
 else{cameraMissFrames++;const last=cameraDetections[cameraDetections.length-1],recent=last&&performance.now()-last.at<1400;if(cameraMissFrames<=2&&recent){$('cameraStatus').textContent='Marker bị khuất thoáng qua; đang giữ xác nhận ngắn hạn, hãy giữ phiếu trong vùng camera.';}else{cameraDetections=[];$('cameraState').classList.remove('camera-ready');$('cameraStatus').textContent='Đưa trọn phiếu vào khung hình; bảo đảm thấy đủ bốn góc và ánh sáng rõ.';}}
 }catch(e){console.warn('[OMR camera] Lỗi phân tích khung hình:',e);cameraMissFrames++;if(cameraMissFrames>2){cameraDetections=[];$('cameraState').classList.remove('camera-ready');}$('cameraStatus').textContent='Không phân tích được khung hình camera. Hãy giữ phiếu trọn vùng xem và thử thêm ánh sáng.';}finally{if(frame)frame.delete();cameraScanBusy=false;if(cameraActive)scheduleCameraScan(cameraTriggered?350:300);}}
function captureLiveFrame(){const video=$('cameraVideo'),canvas=$('cameraCaptureCanvas');try{if(!video.videoWidth||!video.videoHeight)throw Error('Camera chưa cung cấp kích thước khung hình hợp lệ.');canvas.width=video.videoWidth;canvas.height=video.videoHeight;const ctx=canvas.getContext('2d');if(!ctx)throw Error('Không tạo được vùng chụp camera.');ctx.drawImage(video,0,0,canvas.width,canvas.height);canvas.toBlob(blob=>{if(!blob){const failure={stage:'chụp ảnh camera',message:'Không tạo được ảnh từ khung hình camera.'};console.error('[OMR camera]',failure);$('cameraStatus').textContent=`${failure.stage}: ${failure.message} Hãy thử quét lại.`;$('cameraNextBtn').classList.remove('hidden');return;}$('cameraNextBtn').classList.add('hidden');/* The detector uses reduced coordinates only for stability; OMR captures and re-detects on the full uncropped video frame. */processImage(blob,(ok,failure)=>{if(ok)$('cameraStatus').textContent='Đã chấm xong. Lấy phiếu ra rồi nhấn “Quét phiếu tiếp” để quét bài tiếp theo.';else{const reason=failure?`${failure.stage}: ${failure.message}`:'Không xác định được nguyên nhân.';$('cameraStatus').textContent=`Không chấm được ảnh (${reason}). Lấy phiếu ra rồi nhấn “Quét phiếu tiếp” để thử lại.`;}$('cameraNextBtn').classList.remove('hidden');});},'image/jpeg',0.95);}catch(e){const failure={stage:'chụp ảnh camera',message:e?.message||String(e)};console.error('[OMR camera]',failure);$('cameraStatus').textContent=`${failure.stage}: ${failure.message} Hãy thử quét lại.`;$('cameraNextBtn').classList.remove('hidden');}}
async function startCameraScanner(){if(currentUser&&window.OmrCloud?.isConfigured()&&!accountDataReady){$('status').textContent='Cấu hình tài khoản đang tải. Hãy thử mở camera lại sau ít giây.';return;}if(!navigator.mediaDevices?.getUserMedia){$('status').textContent='Thiết bị hoặc trình duyệt không hỗ trợ camera trực tiếp. Dùng Photo để tải ảnh.';return;}if(!cvReady){if(cameraStartPending)return;cameraStartPending=true;$('status').textContent='Đang đợi OpenCV.js sẵn sàng trước khi mở camera…';ensureOpenCv().then(api=>{cameraStartPending=false;if(api)startCameraScanner();});return;}try{$('cameraDialog').showModal();cameraActive=true;cameraTriggered=false;cameraWaitingForClear=false;cameraClearFrames=0;cameraMissFrames=0;cameraDetections=[];cameraNextBtn.classList.add('hidden');cameraState.classList.remove('camera-ready');const video=$('cameraVideo'),tracks=cameraStream?.getVideoTracks?.()||[],live=cameraStream&&tracks.some(t=>t.readyState==='live');if(!live){cameraStream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}}});cameraStream.getTracks().forEach(track=>{track.addEventListener('ended',()=>{if(cameraStream?.getTracks().every(t=>t.readyState!=='live')){cameraActive=false;clearTimeout(cameraTimer);$('cameraStatus').textContent='Kết nối camera đã dừng. Đóng rồi mở camera lại hoặc dùng Photo.';}});});}video.srcObject=cameraStream;await video.play();fitCameraPreview();$('cameraStatus').textContent='Đưa trọn phiếu vào vùng xem; hệ thống tự quét khi bốn marker ổn định.';scheduleCameraScan(150);}catch(e){stopCameraScanner();const message=e.name==='NotAllowedError'?'Bạn chưa cấp quyền camera. Hãy cho phép camera hoặc dùng Photo.':e.name==='NotFoundError'?'Không tìm thấy camera trên thiết bị. Hãy dùng Photo.':`Không mở được camera: ${e.message||e}`;$('status').textContent=message;}}
function stopCameraScanner(){cameraActive=false;cameraTriggered=false;cameraWaitingForClear=false;cameraClearFrames=0;cameraMissFrames=0;cameraDetections=[];clearTimeout(cameraTimer);if(cameraStream){cameraStream.getTracks().forEach(t=>t.stop());cameraStream=null;}$('cameraVideo').srcObject=null;if($('cameraDialog').open)$('cameraDialog').close();}
function loadKeys(){$('opencvRetryBtn').addEventListener('click',retryOpenCv);window.addEventListener('resize',fitCameraPreview);$('cameraVideo').addEventListener('loadedmetadata',fitCameraPreview);loadConfig();$('versionCount').addEventListener('change',renderAnswerKeys);['questionCount','maxScore'].forEach(id=>$(id).addEventListener('change',persistConfig));$('settingsOpenBtn').addEventListener('click',()=>{$('settingsStatus').textContent='';$('examSettingsDialog').showModal();});$('settingsCloseBtn').addEventListener('click',()=>$('examSettingsDialog').close());$('settingsSaveBtn').addEventListener('click',()=>{try{validateConfig();persistConfig();$('settingsStatus').textContent='Đã lưu cấu hình.';$('examSettingsDialog').close();}catch(e){$('settingsStatus').textContent=e.message||String(e);}});$('resetExamConfigBtn').addEventListener('click',resetExamConfiguration);$('importFile').addEventListener('change',e=>{if(e.target.files[0])handleImportFile(e.target.files[0]);});$('importApplyBtn').addEventListener('click',applyImportedKeys);$('status').textContent=cvReady?'OpenCV.js sẵn sàng. Có thể tải ảnh hoặc mở camera để chấm.':'Cấu hình đề sẵn sàng. OpenCV.js đang khởi động…';}
function currentCvModule(){try{if(typeof cv!=='undefined'&&cv)return cv;}catch(error){console.warn('[OMR] Không thể đọc binding cv:',error);}return window.cv||null;}
const verifiedCvRuntimes=new WeakSet();
function cvApiReady(api){try{if(!api||!['Mat','MatVector','Scalar','Size','imread','imshow','findContours','getPerspectiveTransform','warpPerspective','perspectiveTransform','cvtColor','threshold','adaptiveThreshold','approxPolyDP','arcLength','boundingRect','contourArea','countNonZero','isContourConvex','moments','resize','rotate','getBuildInformation'].every(name=>typeof api[name]==='function'))return false;if(typeof api.calledRun==='boolean'&&!api.calledRun)return false;if(verifiedCvRuntimes.has(api))return true;const info=api.getBuildInformation();if(typeof info!=='string'||!info.includes('OpenCV'))return false;verifiedCvRuntimes.add(api);return true;}catch{return false;}}
function markCvReady(api){
    if(api&&cvApiReady(api)){
        try{if(typeof cv!=='undefined'&&cv!==api&&typeof cv?.then==='function')cv=api;}catch(error){console.warn('[OMR] Không thể thay binding cv bằng runtime đã khởi tạo; tiếp tục dùng API đã phân giải.',error);}
        try{window.cv=api;}catch(error){console.warn('[OMR] Không thể gán window.cv; tiếp tục dùng binding cv hiện có.',error);}
    }
    const readyApi=cvApiReady(api)?api:currentCvModule();
    if(!cvApiReady(readyApi)){failCvInitialization(new Error('OpenCV.js chưa cung cấp đầy đủ API sau khi khởi tạo.'));return false;}
    if(cvReady)return true;
    cvReady=true;cvLoadState='ready';cvInitError=null;
    $('opencvRetryBtn').classList.add('hidden');
    $('status').textContent=appBootstrapError?`OpenCV.js đã sẵn sàng, nhưng giao diện gặp lỗi khởi động: ${appBootstrapError}`:'OpenCV.js sẵn sàng. Có thể tải ảnh hoặc mở camera để chấm.';
    console.info('[OMR] OpenCV.js runtime đã sẵn sàng và API đã được xác minh.');
    if(cvResolveAttempt){const resolve=cvResolveAttempt;cvResolveAttempt=null;cvRejectAttempt=null;resolve(true);}
    return true;
}
function failCvInitialization(error){if(cvReady)return;cvInitError=error?.message||String(error||'Không xác định được lỗi OpenCV.js.');console.error('[OMR] OpenCV.js initialization failed:',error);if(cvRejectAttempt){const reject=cvRejectAttempt;cvResolveAttempt=null;cvRejectAttempt=null;reject(new Error(cvInitError));}}
function showOpenCvLoadError(error){cvReady=false;if(cvLoadState!=='loaded'&&cvLoadState!=='uncertain')cvLoadState='failed';if(error)cvInitError=error?.message||String(error);const runtimeWasLoaded=cvLoadState==='loaded',requestWasUncertain=cvLoadState==='uncertain';$('status').textContent=`Không tải hoặc khởi tạo được OpenCV.js${cvInitError?`: ${cvInitError}`:''}.${runtimeWasLoaded?' Runtime đã tải nhưng chưa sẵn sàng; hãy tải lại trang để tránh nạp chồng thư viện.':requestWasUncertain?'Yêu cầu tải bị treo không rõ trạng thái; hãy tải lại trang trước khi thử lại.':' Hãy kiểm tra mạng rồi bấm “Thử tải lại OpenCV.js”.'}`;$('opencvRetryBtn').textContent=runtimeWasLoaded||requestWasUncertain?'Tải lại trang':'Thử tải lại OpenCV.js';$('opencvRetryBtn').classList.remove('hidden');console.error('[OMR] OpenCV.js chưa sẵn sàng.',cvInitError||'');}
function observeCvRuntime(){
    if(cvReady)return true;
    const candidate=currentCvModule();
    if(candidate&&typeof candidate.then==='function'){
        if(candidate!==cvObservedPromise){
            cvObservedPromise=candidate;
            candidate.then(module=>{
                const api=cvApiReady(module)?module:(module?.default||module?.cv||module);
                if(cvApiReady(api))markCvReady(api);
                else failCvInitialization(new Error('Promise OpenCV.js hoàn tất nhưng API không hợp lệ.'));
            },failCvInitialization);
        }
        return false;
    }
    if(!candidate)return false;
    if(cvApiReady(candidate))return markCvReady(candidate);
    hookCvRuntimeCallback(candidate);
    return false;
}
function hookCvRuntimeCallback(target){
    if(!target||target.__omrRuntimeHookInstalled)return;
    try{
        const previous=target.onRuntimeInitialized;
        target.onRuntimeInitialized=function(...args){
            try{if(typeof previous==='function')previous.apply(this,args);}
            catch(error){console.error('[OMR] Callback OpenCV.js hiện có phát sinh lỗi:',error);}
            observeCvRuntime();
        };
        target.__omrRuntimeHookInstalled=true;
    }catch(error){console.warn('[OMR] Không thể gắn callback runtime; tiếp tục kiểm tra API định kỳ.',error);}
}
function installCvRuntimeHook(){
    const moduleObject=window.Module||(window.Module={});
    hookCvRuntimeCallback(moduleObject);
    const cvModule=currentCvModule();
    if(cvModule&&typeof cvModule==='object')hookCvRuntimeCallback(cvModule);
}
function loadCvScript(url,isFallback){return new Promise((resolve,reject)=>{let settled=false;const script=document.createElement('script');const loadTimer=setTimeout(()=>{if(settled)return;settled=true;script.remove();cvLoadState='uncertain';const error=new Error(`Hết thời gian tải tập lệnh OpenCV.js từ ${new URL(url).host} (30 giây).`);error.code='SCRIPT_LOAD_TIMEOUT';reject(error);},30000);script.async=true;script.dataset.omrOpenCv='true';script.dataset.omrFallback=isFallback?'true':'false';script.src=url;script.onload=()=>{if(settled)return;settled=true;clearTimeout(loadTimer);cvLoadState='loaded';$('status').textContent='Đã tải tệp OpenCV.js; đang khởi tạo runtime WebAssembly…';console.info('[OMR] Tệp OpenCV.js đã tải; đang đợi runtime WebAssembly sẵn sàng.',{fallback:isFallback});resolve();};script.onerror=()=>{if(settled)return;settled=true;clearTimeout(loadTimer);script.remove();cvLoadState='failed';reject(new Error(`Không tải được tập lệnh OpenCV.js từ ${new URL(url).host}.`));};document.head.appendChild(script);});}
function ensureOpenCv(){
    const available=currentCvModule();
    if(cvReady&&cvApiReady(available))return Promise.resolve(true);
    if(cvInitPromise)return cvInitPromise;
    if(cvApiReady(available)){markCvReady(available);return Promise.resolve(true);}
    cvInitError=null;cvObservedPromise=null;cvLoadState='loading';
    $('status').textContent='Đang khởi tạo OpenCV.js…';
    installCvRuntimeHook();
    const attempt=new Promise((resolve,reject)=>{
        let settled=false,timeoutId=null,pollId=null;
        cvResolveAttempt=()=>{if(settled)return;settled=true;clearTimeout(timeoutId);clearInterval(pollId);resolve(true);};
        cvRejectAttempt=error=>{if(settled)return;settled=true;clearTimeout(timeoutId);clearInterval(pollId);reject(error);};
        const inspect=()=>{if(settled||cvReady)return;observeCvRuntime();};
        const startRuntimeDeadline=()=>{if(timeoutId||settled)return;cvLoadState='loaded';$('status').textContent='OpenCV.js đã tải; đang chờ runtime WebAssembly…';timeoutId=setTimeout(()=>{if(!cvReady)failCvInitialization(new Error('Quá thời gian chờ runtime WebAssembly của OpenCV.js (45 giây sau khi tải script).'));},45000);};
        pollId=setInterval(inspect,150);
        const existing=currentCvModule();
        if(existing&&typeof existing.then==='function'){
            cvLoadState='loaded';observeCvRuntime();startRuntimeDeadline();return;
        }
        if(cvApiReady(existing)){markCvReady(existing);return;}
        const primary='https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.10.0-release.1/dist/opencv.js';
        loadCvScript(primary,false).then(()=>{
            installCvRuntimeHook();startRuntimeDeadline();inspect();
        }).catch(primaryError=>{
            if(settled)return;
            if(primaryError.code==='SCRIPT_LOAD_TIMEOUT'){failCvInitialization(primaryError);return;}
            console.warn('[OMR] CDN OpenCV.js chính báo lỗi tải; thử CDN dự phòng tuần tự.',primaryError);
            const fallback='https://unpkg.com/@techstark/opencv-js@4.10.0-release.1/dist/opencv.js';
            loadCvScript(fallback,true).then(()=>{
                installCvRuntimeHook();startRuntimeDeadline();inspect();
            }).catch(fallbackError=>{
                if(fallbackError.code!=='SCRIPT_LOAD_TIMEOUT')cvLoadState='failed';
                failCvInitialization(new Error(`${primaryError.message} CDN dự phòng cũng lỗi: ${fallbackError.message}`));
            });
        });
    });
    cvInitPromise=attempt.then(()=>true).catch(error=>{showOpenCvLoadError(error);return null;}).finally(()=>{if(!cvReady)cvInitPromise=null;});
    return cvInitPromise;
}
function retryOpenCv(){if(cvReady)return;if(cvInitPromise){$('status').textContent='OpenCV.js vẫn đang được khởi tạo; ứng dụng đang chờ cùng một tiến trình tải.';return;}if(cvLoadState==='loaded'||cvLoadState==='uncertain'){window.location.reload();return;}cvLoadState='idle';cvInitError=null;cvObservedPromise=null;$('opencvRetryBtn').classList.add('hidden');ensureOpenCv();}
function initCv(){ensureOpenCv();}
window.addEventListener('error',event=>{if(!cvReady&&/opencv|wasm|abort/i.test(`${event.filename||''} ${event.message||''}`)){const error=new Error(event.message||'Lỗi runtime OpenCV.js.');failCvInitialization(error);showOpenCvLoadError(error);}});window.addEventListener('unhandledrejection',event=>{if(!cvReady&&/opencv|wasm|abort/i.test(String(event.reason?.message||event.reason||''))){const error=event.reason instanceof Error?event.reason:new Error(String(event.reason));failCvInitialization(error);showOpenCvLoadError(error);}});
$('fileInput').addEventListener('change',e=>{if(e.target.files[0])processImage(e.target.files[0]);});
$('cameraInput').addEventListener('change',e=>{if(e.target.files[0])processImage(e.target.files[0]);});
$('chooseBtn').onclick=()=>$('fileInput').click();
$('cameraBtn').onclick=()=>startCameraScanner();
$('cameraFallbackBtn').onclick=()=>$('cameraInput').click();
$('cameraCloseBtn').onclick=stopCameraScanner;
$('cameraNextBtn').onclick=()=>{cameraTriggered=false;cameraWaitingForClear=true;cameraClearFrames=0;cameraMissFrames=0;cameraDetections=[];$('cameraNextBtn').classList.add('hidden');$('cameraState').classList.remove('camera-ready');$('cameraStatus').textContent='Đang tiếp tục nhận diện. Lấy phiếu vừa chấm ra khỏi khung hình; camera sẽ tự quét phiếu mới.';scheduleCameraScan(80);};
$('cameraDialog').addEventListener('cancel',stopCameraScanner);
$('clearBtn').onclick=()=>location.reload();
try{loadKeys();}catch(error){appBootstrapError=error?.message||String(error);$('status').textContent=`Lỗi khởi động giao diện: ${appBootstrapError}`;console.error('[OMR] UI bootstrap failed:',error);}
initCv();
bindAccountControls();
void initializeAccountFeatures();
