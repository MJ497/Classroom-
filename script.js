 // Firebase configuration
    const firebaseConfig = {
      apiKey: "AIzaSyBo8cWA_2U6aVps16fug4M_E0-wRRhJfio",
      authDomain: "classs-89e58.firebaseapp.com",
      databaseURL: "https://classs-89e58-default-rtdb.firebaseio.com",
      projectId: "classs-89e58",
      storageBucket: "classs-89e58.firebasestorage.app",
      messagingSenderId: "93885082867",
      appId: "1:93885082867:web:36525ce788ced914f01b86"
    };

    // Imports (Firebase modular SDK)
    import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js';
    import {
      getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut
    } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js';
    import {
      getFirestore, doc, setDoc, getDoc, onSnapshot, collection, addDoc, serverTimestamp, query, orderBy, updateDoc, deleteDoc
    } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js';
    import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-storage.js';

    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    const db = getFirestore(app);
    const storage = getStorage(app);

    // App state
    let currentUser = null;
    let currentRoomId = null;
    let localScreenStream = null;
    let mediaRecorder = null;
    let recordedBlobs = [];
    const pcMap = {}; // peer connections keyed by peerId

    // Basic UI refs
    const signBtn = document.getElementById('signBtn');
    const userInfo = document.getElementById('userInfo');
    const createBtn = document.getElementById('createBtn');
    const joinBtn = document.getElementById('joinBtn');
    const roomArea = document.getElementById('roomArea');
    const joinModal = document.getElementById('joinModal');
    const joinInput = document.getElementById('joinInput');
    const closeJoin = document.getElementById('closeJoin');
    const doJoin = document.getElementById('doJoin');

    // Auth
    signBtn.onclick = async () => {
      if (!currentUser) {
        try {
          // Show loading state
          signBtn.disabled = true;
          signBtn.innerHTML = 'Signing in...';
          
          const provider = new GoogleAuthProvider();
          // Add scopes if needed
          provider.addScope('profile');
          provider.addScope('email');
          
          // Force account selection
          provider.setCustomParameters({
            prompt: "select_account"
          });
          
          await signInWithPopup(auth, provider);
        } catch (error) {
          console.error("Sign in error:", error);
          alert("Sign in failed: " + error.message);
          // Reset button state
          signBtn.disabled = false;
          signBtn.innerHTML = 'Sign in';
        }
      } else {
        try {
          await signOut(auth);
        } catch (error) {
          console.error("Sign out error:", error);
        }
      }
    };

    onAuthStateChanged(auth, user => {
      currentUser = user;
      if (user) {
        userInfo.innerText = user.displayName || user.email;
        signBtn.innerText = 'Sign out';
        signBtn.disabled = false;
      } else {
        userInfo.innerText = '';
        signBtn.innerText = 'Sign in';
        signBtn.disabled = false;
      }
    });

    // Create a new classroom
    createBtn.onclick = async () => {
      if (!currentUser) return alert('Please sign in first');
      
      try {
        createBtn.disabled = true;
        createBtn.innerHTML = 'Creating...';
        
        // create a room doc with random id
        const id = generateId(8);
        const roomRef = doc(db, 'rooms', id);
        await setDoc(roomRef, {
          owner: currentUser.uid,
          ownerName: currentUser.displayName || currentUser.email,
          createdAt: serverTimestamp(),
        });
        currentRoomId = id;
        renderClassroom(true);
        // write participant entry for owner
        await setDoc(doc(roomRef, 'participants', currentUser.uid), {
          name: currentUser.displayName || currentUser.email,
          joinedAt: serverTimestamp(),
          host: true
        });

        // listen to participants and chat
        attachRoomListeners(id);

        // show join link
        const link = window.location.origin + window.location.pathname + '?room=' + id;
        alert('Share this join link with students:\n' + link);
      } catch (error) {
        console.error("Error creating classroom:", error);
        alert("Failed to create classroom: " + error.message);
      } finally {
        createBtn.disabled = false;
        createBtn.innerHTML = 'Create classroom';
      }
    };

    // Join modal
    joinBtn.onclick = () => { joinModal.style.display = 'flex'; }
    closeJoin.onclick = () => { joinModal.style.display = 'none'; }
    doJoin.onclick = async () => {
      const val = joinInput.value.trim();
      if (!val) return alert('Enter link or room id');
      
      try {
        doJoin.disabled = true;
        doJoin.innerHTML = 'Joining...';
        
        const id = parseRoomIdFromInput(val);
        const roomRef = doc(db, 'rooms', id);
        const snap = await getDoc(roomRef);
        if (!snap.exists()) return alert('Room not found');
        currentRoomId = id;
        // add participant
        await setDoc(doc(roomRef, 'participants', currentUser ? currentUser.uid : generateId(6)), {
          name: currentUser ? (currentUser.displayName || currentUser.email) : 'Guest-'+generateId(4),
          joinedAt: serverTimestamp(),
          host: false
        });
        joinModal.style.display = 'none';
        renderClassroom(false);
        attachRoomListeners(id);
      } catch (error) {
        console.error("Error joining classroom:", error);
        alert("Failed to join classroom: " + error.message);
      } finally {
        doJoin.disabled = false;
        doJoin.innerHTML = 'Join';
      }
    }

    // Render classroom UI
    function renderClassroom(amHost){
      roomArea.innerHTML = `
        <div class="classroom">
          <div class="panel">
            <h4>Participants</h4>
            <ul id="participantsList" class="participants"></ul>
          </div>
          <div class="panel" style="display:flex;flex-direction:column">
            <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
              <strong>Room:</strong><span id="roomId">${currentRoomId}</span>
              <div style="margin-left:auto;display:flex;gap:8px">
                ${amHost ? '<button id="shareScreenBtn" class="btn small">Share screen</button><button id="startRec" class="btn small">Start recording</button><button id="stopRec" class="btn small" style="display:none;background:#ef4444">Stop</button>' : ''}
                <button id="leaveBtn" class="btn small" style="background:#ef4444">Leave</button>
              </div>
            </div>
            <video id="mainVideo" autoplay playsinline></video>
          </div>
          <div class="panel chat">
            <h4>Chat</h4>
            <div id="messages" class="messages"></div>
            <div class="composer">
              <input id="chatInput" placeholder="Write a message" />
              <button id="sendChat" class="btn small">Send</button>
            </div>
          </div>
        </div>
      `;

      // wire buttons
      document.getElementById('leaveBtn').onclick = leaveRoom;
      document.getElementById('sendChat').onclick = sendChat;
      if (amHost) {
        document.getElementById('shareScreenBtn').onclick = startShare;
        document.getElementById('startRec').onclick = startRecording;
        document.getElementById('stopRec').onclick = stopRecording;
      }
    }

    // Attach listeners: participants, chat, and also prepare for signaling messages
    function attachRoomListeners(roomId){
      const participantsRef = collection(db, 'rooms', roomId, 'participants');
      const pQuery = query(participantsRef);
      onSnapshot(pQuery, snapshot => {
        const list = document.getElementById('participantsList');
        if (!list) return;
        list.innerHTML = '';
        snapshot.forEach(docSnap => {
          const d = docSnap.data();
          const li = document.createElement('li');
          li.textContent = (d.name || 'Unknown') + (d.host ? ' (host)' : '');
          list.appendChild(li);
        });
      });

      // chat
      const messagesRef = collection(db, 'rooms', roomId, 'messages');
      const q = query(messagesRef, orderBy('ts'));
      onSnapshot(q, snap => {
        const messages = document.getElementById('messages');
        if (!messages) return;
        messages.innerHTML = '';
        snap.forEach(s => {
          const m = s.data();
          const div = document.createElement('div'); div.className='msg';
          div.innerHTML = `<strong>${escapeHtml(m.name)}:</strong> ${escapeHtml(m.text)} <div class="small">${new Date(m.ts?.toMillis ? m.ts.toMillis() : Date.now()).toLocaleTimeString()}</div>`;
          messages.appendChild(div);
        });
        messages.scrollTop = messages.scrollHeight;
      });

      // Signaling collections for WebRTC: offers/answers/ice
      const offersRef = collection(db, 'rooms', roomId, 'offers');
      onSnapshot(offersRef, async snap => {
        // When clients post offers, other clients create answers. (Simple mesh-based signaling.)
        snap.docChanges().forEach(async change => {
          const id = change.doc.id;
          const data = change.doc.data();
          if (change.type === 'added') {
            // if this client didn't create the offer, respond
            if (data.from === currentUser?.uid) return;
            console.log('Received offer from', data.from);
            // create RTCPeerConnection and set remote description, create answer
            await handleOffer(roomId, id, data);
          }
        });
      });

      // listen for answers
      const answersRef = collection(db, 'rooms', roomId, 'answers');
      onSnapshot(answersRef, snap => {
        snap.docChanges().forEach(async change => {
          const data = change.doc.data();
          if (change.type === 'added') {
            if (data.to !== currentUser?.uid) return; // answer addressed to me
            const pc = pcMap[data.from];
            if (!pc) return;
            const desc = data.answer;
            await pc.setRemoteDescription(desc);
            console.log('Applied remote answer from', data.from);
          }
        });
      });

      // ice candidates
      const iceRef = collection(db, 'rooms', roomId, 'ice');
      onSnapshot(iceRef, snap => {
        snap.docChanges().forEach(async change => {
          const data = change.doc.data();
          if (data.to && data.to !== currentUser?.uid) return;
          const pc = pcMap[data.from];
          if (!pc) return;
          if (change.type === 'added') {
            try{ await pc.addIceCandidate(data.candidate); }catch(e){ console.warn(e) }
          }
        });
      });
    }

    // Handle incoming offer: create pc, add local tracks (if any), set remote desc, create answer and store
    async function handleOffer(roomId, offerId, offerData){
      const fromId = offerData.from;
      // create pc
      const pc = createPeerConnection(fromId, roomId);
      pcMap[fromId] = pc;
      await pc.setRemoteDescription(offerData.offer);
      // if we have local media (host) - normally only host shares screen; guests don't send tracks.
      // create answer
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      // save answer to firestore
      await addDoc(collection(db, 'rooms', roomId, 'answers'), {
        from: currentUser ? currentUser.uid : 'guest',
        to: fromId,
        answer: pc.localDescription
      });
    }

    // When this client wants to share screen (only host expected)
    async function startShare(){
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({video:true,audio:false});
        localScreenStream = stream;
        const videoEl = document.getElementById('mainVideo');
        videoEl.srcObject = stream;

        // create an offer to notify others
        const roomId = currentRoomId;
        const offer = await createAndSendOffer(roomId);

        // If participants join later, room signaling listeners will exchange offers/answers
        stream.getTracks().forEach(t => t.onended = () => { 
          // Handle screen share ending
          if (videoEl) videoEl.srcObject = null;
          localScreenStream = null;
        });
      } catch(e){ 
        console.error(e); 
        alert('Screen share failed: '+e.message);
      }
    }

    // Create and send offer to Firestore so others will answer
    async function createAndSendOffer(roomId){
      // create temporary pc and set local stream
      const pc = new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'}]});
      // add local tracks
      if (localScreenStream) {
        localScreenStream.getTracks().forEach(t => pc.addTrack(t, localScreenStream));
      }
      pc.onicecandidate = e => {
        if (!e.candidate) return;
        // store candidate to 'ice' collection
        addDoc(collection(db,'rooms',roomId,'ice'),{
          from: currentUser?currentUser.uid:'host', to:null, candidate:e.candidate
        });
      };

      // when remote tracks arrive (for host this will not be used; for viewers it will be used)
      pc.ontrack = e => {
        const videoEl = document.getElementById('mainVideo');
        if (videoEl) videoEl.srcObject = e.streams[0];
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // persist the offer to collection so other clients can pick it up
      await addDoc(collection(db,'rooms',roomId,'offers'),{
        from: currentUser?currentUser.uid:'host', offer:pc.localDescription
      });

      // keep this pc alive in map so answers can be applied
      pcMap['local-offer-'+Date.now()] = pc;
      return offer;
    }

    // Create RTCPeerConnection for incoming offers (guests) so they can play the host stream
    function createPeerConnection(peerId, roomId){
      const pc = new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'}]});
      pc.onicecandidate = e => {
        if (!e.candidate) return;
        addDoc(collection(db,'rooms',roomId,'ice'),{
          from: currentUser?currentUser.uid:'guest', to:peerId, candidate:e.candidate
        });
      };
      pc.ontrack = e => {
        const videoEl = document.getElementById('mainVideo');
        if (videoEl) videoEl.srcObject = e.streams[0];
      };
      return pc;
    }

    // Simple chat
    async function sendChat(){
      const input = document.getElementById('chatInput');
      const text = input.value.trim(); if(!text) return;
      await addDoc(collection(db,'rooms',currentRoomId,'messages'),{
        name: currentUser ? (currentUser.displayName || currentUser.email) : 'Guest',
        text, ts: serverTimestamp()
      });
      input.value = '';
    }

    // Recording (host) using MediaRecorder
    function startRecording(){
      if (!localScreenStream) return alert('Start sharing screen first');
      recordedBlobs = [];
      mediaRecorder = new MediaRecorder(localScreenStream, {mimeType:'video/webm;codecs=vp9'});
      mediaRecorder.ondataavailable = e => { if (e.data && e.data.size) recordedBlobs.push(e.data); };
      mediaRecorder.onstop = async () => {
        const blob = new Blob(recordedBlobs, {type:'video/webm'});
        const fileName = `recordings/${currentRoomId}_${Date.now()}.webm`;
        const rRef = storageRef(storage, fileName);
        await uploadBytes(rRef, blob);
        const url = await getDownloadURL(rRef);
        // save to room doc so owner can find it
        await setDoc(doc(db,'rooms',currentRoomId,'archives','last'),{url,uploadedAt:serverTimestamp()});
        alert('Recording saved to Firebase Storage');
      };
      mediaRecorder.start(1000);
      document.getElementById('startRec').style.display='none';
      document.getElementById('stopRec').style.display='inline-block';
    }
    function stopRecording(){
      if(mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
      document.getElementById('stopRec').style.display='none';
      document.getElementById('startRec').style.display='inline-block';
    }

    // Helper -- leave room
    async function leaveRoom(){
      // remove participant doc if signed in
      if (currentUser && currentRoomId) {
        try{ await deleteDoc(doc(db,'rooms',currentRoomId,'participants',currentUser.uid)); }catch(e){}
      }
      // stop streams
      if (localScreenStream) localScreenStream.getTracks().forEach(t=>t.stop());
      roomArea.innerHTML = '';
      currentRoomId = null;
    }

    // Small helpers
    function generateId(len=6){
      const s = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
      let r=''; for(let i=0;i<len;i++) r+=s[Math.floor(Math.random()*s.length)]; return r;
    }
    function parseRoomIdFromInput(v){
      try{ const u = new URL(v); const p = new URLSearchParams(u.search); return p.get('room') || u.pathname.split('/').pop(); }catch(e){ return v; }
    }
    function escapeHtml(s){
      return (s||'').toString().replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
    }

    // Initialize: if url has ?room=, auto-join (guest)
    (function init(){
      const params = new URLSearchParams(window.location.search);
      const rm = params.get('room');
      if (rm){
        // if user hasn't signed in yet, we'll allow guest join
        currentRoomId = rm;
        renderClassroom(false);
        attachRoomListeners(rm);
      }
    })();