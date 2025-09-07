// app.js (type=module)
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  addDoc,
  updateDoc,
  arrayUnion,
  serverTimestamp,
  getDocs
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

/* --------- CONFIG: paste your Firebase config here --------- */
const firebaseConfig = {
  apiKey: "AIzaSyAl136XisbVZWuk1dXNfSWRJcq0YI34h6E",
  authDomain: "nano-chat-ae3d9.firebaseapp.com",
  projectId: "nano-chat-ae3d9",
  storageBucket: "nano-chat-ae3d9.firebasestorage.app",
  messagingSenderId: "637284077729",
  appId: "1:637284077729:web:fa489eea640847f38de0e0e0",
  measurementId:"G-NYSW7NTJHB",
};
/* ----------------------------------------------------------- */

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();
const db = getFirestore(app);
/* --------- helpers (short friend code) --------- */
function makeFriendCode() {
  // 6-character human-friendly code (no ambiguous chars)
  const alph = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += alph[Math.floor(Math.random() * alph.length)];
  return s;
}

/* --------- UI nodes --------- */
const signinBtn = document.getElementById("signin-btn");
const authArea = document.getElementById("auth-area");
const profileEl = document.getElementById("profile");
const friendInput = document.getElementById("friend-code-input");
const addFriendBtn = document.getElementById("add-friend-btn");
const friendsList = document.getElementById("friends-list");
const createRoomBtn = document.getElementById("create-room-btn");
const roomNameInput = document.getElementById("room-name");
const roomsList = document.getElementById("rooms-list");

const chatWindow = document.getElementById("chat-window");
const emptyState = document.getElementById("empty-state");
const roomTitle = document.getElementById("room-title");
const roomIdEl = document.getElementById("room-id");
const friendInviteSelect = document.getElementById("friend-invite-select");
const inviteBtn = document.getElementById("invite-btn");
const messagesEl = document.getElementById("messages");
const messageInput = document.getElementById("message-input");
const sendBtn = document.getElementById("send-btn");

let currentUser = null;
let currentProfile = null;
let roomsUnsub = null;
let messagesUnsub = null;
let activeRoom = null;

/* --------- Auth handlers --------- */
signinBtn?.addEventListener("click", async () => {
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    alert("Sign-in failed: " + e.message);
  }
});

function renderSignedOut() {
  authArea.innerHTML = `<button id="signin-btn-2" class="btn primary">Sign in with Google</button>`;
  document.getElementById("signin-btn-2").addEventListener("click", async () => {
    try { await signInWithPopup(auth, provider); } catch(e){ alert(e.message) }
  });
  profileEl.innerHTML = `<div class="small">Not signed in</div>`;
  roomsList.innerHTML = "";
  friendsList.innerHTML = "";
  hideChat();
}

function renderSignedIn(u, profile) {
  authArea.innerHTML = `
    <div class="small">${escapeHtml(profile.name || u.displayName || "")}</div>
    <button id="signout-btn" class="btn">Sign out</button>
  `;
  document.getElementById("signout-btn").addEventListener("click", async ()=>{
    await signOut(auth);
  });

  profileEl.innerHTML = `
    <img src="${escapeHtml(profile.photoURL||u.photoURL||'https://via.placeholder.com/80')}" alt="avatar">
    <div>
      <div style="font-weight:600">${escapeHtml(profile.name||u.displayName||'')}</div>
      <div class="small">Code: <strong>${escapeHtml(profile.friendCode||'')}</strong></div>
      <div class="small">UID: <span class="tiny">${u.uid}</span></div>
    </div>
  `;
}

/* --------- Utility: escape HTML --------- */
function escapeHtml(s){ return String(s||'').replace(/[&<>"'`]/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;","`":"&#x60;"}[c])); }

/* --------- On auth state change --------- */
onAuthStateChanged(auth, async (u) => {
  if (!u) {
    currentUser = null;
    currentProfile = null;
    if (roomsUnsub) { roomsUnsub(); roomsUnsub = null; }
    if (messagesUnsub) { messagesUnsub(); messagesUnsub = null; }
    renderSignedOut();
    return;
  }

  currentUser = u;
  // ensure user doc exists
  const userRef = doc(db, "users", u.uid);
  const snap = await getDoc(userRef);
  if (!snap.exists()) {
    // make friend code and write profile
    let code = makeFriendCode();
    // NOTE: small chance of collision — for production you may want a uniqueness check with an index
    await setDoc(userRef, {
      uid: u.uid,
      name: u.displayName || "",
      email: u.email || "",
      photoURL: u.photoURL || "",
      friendCode: code,
      friends: [],
      createdAt: serverTimestamp()
    });
    currentProfile = { uid: u.uid, name: u.displayName || "", photoURL: u.photoURL || "", friendCode: code, friends: [] };
  } else {
    currentProfile = snap.data();
  }

  renderSignedIn(u, currentProfile);
  subscribeRooms();
  renderFriends();
});

/* --------- Rooms subscription (rooms where user is a member) --------- */
function subscribeRooms() {
  if (!currentUser) return;
  if (roomsUnsub) roomsUnsub();

  const q = query(collection(db, "rooms"), where("members", "array-contains", currentUser.uid), orderBy("updatedAt","desc"));
  roomsUnsub = onSnapshot(q, (snap)=>{
    roomsList.innerHTML = "";
    const rooms = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    rooms.forEach(r => {
      const div = document.createElement("div");
      div.className = "room-item";
      div.innerHTML = `<div><strong>${escapeHtml(r.name)}</strong><div class="small">members: ${r.members?.length||0}</div></div>`;
      div.addEventListener("click", ()=> openRoom(r));
      roomsList.appendChild(div);
    });
  });
}

/* --------- Create a room --------- */
createRoomBtn?.addEventListener("click", async ()=>{
  if (!currentUser) { alert("Sign in first"); return; }
  const name = (roomNameInput.value || "").trim();
  if (!name) return alert("Room name required");
  const docRef = await addDoc(collection(db, "rooms"), {
    name,
    members: [currentUser.uid],
    ownerUid: currentUser.uid,
    isPrivate: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  roomNameInput.value = "";
  // room will appear via subscription; optionally open it directly
});

/* --------- Add friend by friendCode (sends request or directly adds) --------- */
addFriendBtn?.addEventListener("click", async ()=>{
  if (!currentUser) return alert("Sign in first");
  const code = (friendInput.value || "").trim().toUpperCase();
  if (!code) return;
  // find a user with that code
  const q = query(collection(db, "users"), where("friendCode", "==", code));
  const res = await getDocs(q);
  if (res.empty) { alert("Friend code not found"); return; }
  const friendDoc = res.docs[0];
  const friendUid = friendDoc.id;
  if (friendUid === currentUser.uid) { alert("That's you!"); friendInput.value=""; return; }

  // For simplicity: update both users' friend arrays
  await updateDoc(doc(db, "users", currentUser.uid), { friends: arrayUnion(friendUid) });
  await updateDoc(doc(db, "users", friendUid), { friends: arrayUnion(currentUser.uid) });
  friendInput.value = "";
  alert("Friend added.");
  renderFriends();
});

/* --------- Render friends list & invite select --------- */
async function renderFriends() {
  if (!currentUser) return;
  const uref = doc(db, "users", currentUser.uid);
  const snap = await getDoc(uref);
  const profile = snap.exists() ? snap.data() : null;
  const friends = profile?.friends || [];
  friendsList.innerHTML = "";
  friendInviteSelect.innerHTML = "<option value=''>-- pick friend --</option>";

  if (friends.length === 0) {
    friendsList.innerHTML = `<div class="small">No friends yet</div>`;
    return;
  }

  // resolve friend docs
  for (const f of friends) {
    const snapF = await getDoc(doc(db, "users", f));
    const data = snapF.exists() ? snapF.data() : { name: f };
    const el = document.createElement("div");
    el.className = "friend-row";
    el.innerHTML = `<div><strong>${escapeHtml(data.name||'')}</strong><div class="small">${escapeHtml(data.friendCode||f)}</div></div>
                    <div><button class="btn" data-uid="${f}">Start Room</button></div>`;
    const btn = el.querySelector("button");
    btn.addEventListener("click", ()=> createDirectRoomWith(f));
    friendsList.appendChild(el);

    // add to invite dropdown
    const opt = document.createElement("option");
    opt.value = f;
    opt.textContent = `${data.name || f} — ${data.friendCode || ''}`;
    friendInviteSelect.appendChild(opt);
  }
}

/* --------- Create direct room with friend (or reuse existing) --------- */
async function createDirectRoomWith(friendUid) {
  // naive approach: always create new room. For production, search for existing 1:1 room.
  const name = "Chat with friend";
  const r = await addDoc(collection(db, "rooms"), {
    name,
    members: [currentUser.uid, friendUid],
    ownerUid: currentUser.uid,
    isPrivate: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  // onSnapshot will show room; find it and open
}

/* --------- Open a room and subscribe to messages --------- */
async function openRoom(room) {
  activeRoom = room;
  emptyState.classList.add("hidden");
  chatWindow.classList.remove("hidden");
  roomTitle.textContent = room.name;
  roomIdEl.textContent = `Room ID: ${room.id}`;

  // populate invite dropdown with friends (re-run renderer)
  await renderFriends();

  // unsubscribe previous
  if (messagesUnsub) messagesUnsub();

  // listen to messages
  const msgsRef = collection(db, `rooms/${room.id}/messages`);
  const q = query(msgsRef, orderBy("createdAt"));
  messagesUnsub = onSnapshot(q, async (snap) => {
    messagesEl.innerHTML = "";
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    for (const m of docs) {
      // resolve sender data
      const sref = doc(db, "users", m.senderUid || m.sender);
      const sSnap = await getDoc(sref);
      const sdata = sSnap.exists() ? sSnap.data() : { name: m.sender || "Unknown", photoURL: "" };
      appendMessage(m, sdata, (currentUser.uid === (m.senderUid || m.sender)));
    }
    // scroll bottom
    messagesEl.scrollTop = messagesEl.scrollHeight;
  });
}

/* --------- Append message to UI --------- */
function appendMessage(m, senderProfile, isMe) {
  const div = document.createElement("div");
  div.className = "msg " + (isMe ? "me" : "");
  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = `${senderProfile.name || m.sender || 'User' } • ${new Date(m.createdAt?.toMillis ? m.createdAt.toMillis() : (m.createdAt? m.createdAt.seconds*1000: Date.now())).toLocaleString()}`;
  const body = document.createElement("div");
  body.textContent = m.text;
  div.appendChild(meta);
  div.appendChild(body);
  messagesEl.appendChild(div);
}

/* --------- Send message --------- */
sendBtn?.addEventListener("click", sendMessage);
messageInput?.addEventListener("keydown", (e)=>{ if (e.key === "Enter") sendMessage(); });

async function sendMessage() {
  const text = (messageInput.value || "").trim();
  if (!text || !activeRoom) return;
  const msgsRef = collection(db, `rooms/${activeRoom.id}/messages`);
  await addDoc(msgsRef, {
    senderUid: currentUser.uid,
    text,
    createdAt: serverTimestamp()
  });
  // update room updatedAt
  await updateDoc(doc(db, "rooms", activeRoom.id), { updatedAt: serverTimestamp() });
  messageInput.value = "";
}

/* --------- Invite friend to active room via select --------- */
inviteBtn?.addEventListener("click", async ()=>{
  const uid = friendInviteSelect.value;
  if (!uid || !activeRoom) return alert("Pick a friend and a room");
  await updateDoc(doc(db, "rooms", activeRoom.id), { members: arrayUnion(uid), updatedAt: serverTimestamp() });
  alert("Invited");
});

/* --------- hide chat UI --------- */
function hideChat() {
  emptyState.classList.remove("hidden");
  chatWindow.classList.add("hidden");
}

/* --------- initial render for signed out state --------- */
renderSignedOut();
