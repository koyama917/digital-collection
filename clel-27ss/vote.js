// 投票ウィジェット(Firebase版)。index.html からのみ読み込まれる。
// 仕様: 1人(=1ブラウザ)あたり ○(通常)4票 + ◎(一番)1票 = 合計5票。自分の投票は端末に保存され、Firestoreに同期される。
// 集計結果は閲覧者には表示しない(社内のスプレッドシートで確認)。

(function(){
  var CFG = window.VOTE_CONFIG || {};
  var MAX = CFG.maxVotes || 5, MAXB = CFG.maxBest || 1, CID = CFG.collectionId || 'default';
  var marks = {}; // {look01:'o'|'w'}
  var uid = null, db = null, ready = false, dirty = false, timer = null;
  var toastEl = document.getElementById('toast');

  function toast(msg, ms){ if(!toastEl) return; toastEl.textContent = msg; toastEl.hidden = false; clearTimeout(toastEl._t); toastEl._t = setTimeout(function(){ toastEl.hidden = true; }, ms || 2200); }
  function count(t){ return Object.keys(marks).filter(function(k){ return marks[k] === t; }).length; }
  function paint(){
    var o = count('o'), w = count('w');
    document.querySelectorAll('.vote').forEach(function(v){
      var id = v.getAttribute('data-look'); if(!id) return;
      var m = marks[id] || '';
      v.querySelector('.vo').classList.toggle('on', m === 'o');
      v.querySelector('.vw').classList.toggle('on', m === 'w');
      v.querySelector('.vo').setAttribute('aria-pressed', m === 'o' ? 'true' : 'false');
      v.querySelector('.vw').setAttribute('aria-pressed', m === 'w' ? 'true' : 'false');
      v.classList.toggle('voted', !!m);
    });
    document.querySelectorAll('.card').forEach(function(c){ c.classList.toggle('is-voted', !!marks[c.getAttribute('data-look')]); });
    var bar = document.getElementById('votebar');
    if(bar){
      bar.querySelector('.vb-o').textContent = String(Math.max(0, (MAX - MAXB) - o));
      bar.querySelector('.vb-w').textContent = String(Math.max(0, MAXB - w));
      var done = o + w;
      bar.querySelector('.vb-done').textContent = done + ' / ' + MAX;
      bar.classList.toggle('complete', done >= MAX);
    }
  }
  function setMark(id, t){
    var cur = marks[id] || '';
    if(cur === t){ delete marks[id]; }
    else if(t === 'w'){
      // ◎は1つだけ: 既にある◎を外して移す
      Object.keys(marks).forEach(function(k){ if(marks[k] === 'w') delete marks[k]; });
      if(cur === 'o'){ /* ○→◎ に格上げ */ }
      marks[id] = 'w';
      if(count('o') + count('w') > MAX){ delete marks[id]; toast('投票は合計' + MAX + 'つまでです。先にどれかを外してください'); }
      else if(cur !== 'w') toast('◎ 一番のお気に入りにしました');
    } else {
      if(cur === 'w'){ marks[id] = 'o'; }
      else {
        if(count('o') >= MAX - MAXB){ toast('○は' + (MAX - MAXB) + 'つまでです。先にどれかを外してください'); return paint(); }
        marks[id] = 'o';
      }
    }
    paint(); persistLocal(); scheduleSave();
  }
  function persistLocal(){ try{ localStorage.setItem('vote_' + CID, JSON.stringify(marks)); }catch(e){} }
  function loadLocal(){ try{ var s = localStorage.getItem('vote_' + CID); if(s) marks = JSON.parse(s) || {}; }catch(e){} }
  function scheduleSave(){ dirty = true; clearTimeout(timer); timer = setTimeout(function(){ if(window.__voteSave) window.__voteSave(); }, 700); }
  document.addEventListener('click', function(e){
    var b = e.target.closest ? e.target.closest('.vo,.vw') : null; if(!b) return;
    e.preventDefault(); e.stopPropagation();
    var v = b.closest('.vote'); var id = v && v.getAttribute('data-look'); if(!id) return;
    setMark(id, b.classList.contains('vw') ? 'w' : 'o');
  });
  window.addEventListener('beforeunload', function(){ if(dirty && window.__voteSave) window.__voteSave(); });
  window.__vote = { paint: paint };

  loadLocal(); paint();
  var FB = null; // {doc,setDoc,getDoc,serverTimestamp}
  function save(){
    if(!ready || !uid || !db || !FB){ return; }
    var payload = { marks: marks, ts: Date.now(), updated: FB.serverTimestamp(), ua: (navigator.userAgent || '').slice(0, 120) };
    FB.setDoc(FB.doc(db, 'collections', CID, 'ballots', uid), payload, { merge: false })
      .then(function(){ dirty = false; })
      .catch(function(e){ console.warn('vote save failed', e && e.code); toast('保存できませんでした。通信環境を確認してもう一度押してください', 3500); });
  }
  window.__voteSave = save;
  if(!CFG.firebase || !CFG.firebase.apiKey){
    if(CFG.demo){ toast('デモ表示: 投票はこの端末内にだけ保存されます(本番は集計サーバーに保存)', 4500); }
    else { toast('投票の設定が未完了です(管理者向け表示)', 4000); }
    return;
  }
  Promise.all([
    import("https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js"),
    import("https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js")
  ]).then(function(m){
    var appM = m[0], authM = m[1], fsM = m[2];
    FB = { doc: fsM.doc, setDoc: fsM.setDoc, getDoc: fsM.getDoc, serverTimestamp: fsM.serverTimestamp };
    var app = appM.initializeApp(CFG.firebase); var auth = authM.getAuth(app); db = fsM.getFirestore(app);
    authM.onAuthStateChanged(auth, function(user){
      if(!user){ authM.signInAnonymously(auth).catch(function(e){ console.warn('anon auth failed', e && e.code); toast('投票の準備に失敗しました。時間をおいて開き直してください', 3500); }); return; }
      uid = user.uid; ready = true;
      fsM.getDoc(fsM.doc(db, 'collections', CID, 'ballots', uid)).then(function(snap){
        if(snap.exists() && !dirty){ var d = snap.data(); if(d && d.marks){ marks = d.marks; persistLocal(); paint(); } }
        else if(dirty){ save(); }
      }).catch(function(e){ console.warn('vote load failed', e && e.code); });
    });
  }).catch(function(e){ console.warn('firebase load failed', e); toast('投票サーバーに接続できませんでした。この端末内にだけ保存します', 4000); });
})();
