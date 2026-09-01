// Split out of app.js: the messaging feature — conversation list/thread
// state, the compose/send flow, the new-message recipient typeahead, and a
// 20s poll for new activity. Depends on app/theme-language.js and
// app/backend-client.js (loaded earlier). findAnyTask, closeModal, openModal,
// and render are still defined later in the app.js trunk, so those calls go
// through window.SkillNestApp.foo() instead of a destructure.
//
// messagingThread and messagesFilter are read directly by render() in the
// trunk (Pages.messagesPage(...) needs the live thread state). A plain `let`
// can't be read across closures the way a function can be lazily looked up,
// so getMessagingThread()/getMessagingFilter() are exported as getters and
// the trunk calls them instead of reading the variables directly.
window.SkillNestApp = window.SkillNestApp || {};
Object.assign(window.SkillNestApp, (() => {
  const { operators, clients } = window.SkillNestData;
  const C = window.SkillNestComponents;
  const {
    readJson, backendToken, backendFetch, currentRoute, setRoute, isLoggedIn,
    trySetLocalStorage, getPostedTasks, getMissions,
  } = window.SkillNestApp;

  // null = never fetched for this session (show "loading"), [] = genuinely
  // no conversations — the distinction stops a fresh login from flashing
  // "No conversations yet" while the first fetch is in flight.
  let messagingThread = { conversationId: null, conversation: null, messages: [], loading: false };
  let messagesFilter = "all";

  function getMessagingThread() {
    return messagingThread;
  }

  function getMessagingFilter() {
    return messagesFilter;
  }

  function getConversations() {
    return readJson("hatchConversationsCache", null);
  }

  function getMessagesUnread() {
    return Number(localStorage.getItem("hatchMessagesUnreadCache") || 0);
  }

  function clearMessagingState() {
    messagingThread = { conversationId: null, conversation: null, messages: [], loading: false };
    messagesFilter = "all";
    localStorage.removeItem("hatchConversationsCache");
    localStorage.removeItem("hatchMessagesUnreadCache");
    localStorage.removeItem("hatchInboxCache"); // pre-messaging cache cleanup
  }

  // Updates the nav badge in place — a full render() would wipe whatever the
  // user is typing just to change a number.
  function updateNavMessagesBadge() {
    const badge = document.querySelector("[data-msg-badge]");
    if (!badge) return;
    const count = getMessagesUnread();
    badge.hidden = count === 0;
    badge.textContent = count > 99 ? "99+" : String(count);
  }

  // Re-render, but keep the half-typed chat message and its focus alive
  // across the innerHTML swap.
  function rerenderPreservingCompose() {
    const input = document.getElementById("chatComposeInput");
    const value = input ? input.value : "";
    const hadFocus = document.activeElement === input;
    window.SkillNestApp.render();
    const next = document.getElementById("chatComposeInput");
    if (next && value) next.value = value;
    if (next && hadFocus) next.focus();
  }

  let conversationsRefreshInFlight = false;
  async function refreshConversations() {
    if (!backendToken() || conversationsRefreshInFlight) return;
    conversationsRefreshInFlight = true;
    const data = await backendFetch("/api/messages/conversations");
    conversationsRefreshInFlight = false;
    if (!data?.ok) return;
    localStorage.setItem("hatchMessagesUnreadCache", String(data.unreadCount || 0));
    updateNavMessagesBadge();
    const list = data.conversations || [];
    if (JSON.stringify(list) !== localStorage.getItem("hatchConversationsCache")) {
      // Participant avatars can make this payload large; if the quota-guarded
      // write fails, retry with avatars stripped so the list still renders.
      if (!trySetLocalStorage("hatchConversationsCache", list)) {
        trySetLocalStorage("hatchConversationsCache", list.map((conversation) => ({
          ...conversation,
          participants: (conversation.participants || []).map((p) => ({ ...p, avatar: "" })),
        })));
      }
      if (currentRoute() === "messages" || currentRoute() === "profile") rerenderPreservingCompose();
    }
  }

  async function refreshMessagesUnread() {
    if (!backendToken()) return;
    const data = await backendFetch("/api/messages/unread-count");
    if (!data?.ok) return;
    const next = String(data.unreadCount || 0);
    if (next !== localStorage.getItem("hatchMessagesUnreadCache")) {
      localStorage.setItem("hatchMessagesUnreadCache", next);
      updateNavMessagesBadge();
    }
  }

  async function openConversation(id) {
    id = Number(id);
    messagingThread = { conversationId: id, conversation: null, messages: [], loading: true };
    if (currentRoute() !== "messages") setRoute("messages");
    window.SkillNestApp.render();

    const data = await backendFetch(`/api/messages/conversations/${id}`);
    // Stale response: the user opened another thread (or closed the pane)
    // while this fetch was in flight — don't clobber the newer state.
    if (messagingThread.conversationId !== id) return;
    if (!data?.ok) {
      messagingThread = { conversationId: null, conversation: null, messages: [], loading: false };
      window.SkillNestApp.render();
      return;
    }
    messagingThread = {
      conversationId: id,
      conversation: data.conversation,
      messages: data.messages || [],
      loading: false,
    };
    window.SkillNestApp.render();

    if (data.conversation.unreadCount > 0) {
      await backendFetch(`/api/messages/conversations/${id}/read`, { method: "POST" });
      refreshConversations();
    }
  }

  function closeThread() {
    messagingThread = { conversationId: null, conversation: null, messages: [], loading: false };
    window.SkillNestApp.render();
  }

  function setMessagesFilter(filter) {
    messagesFilter = filter;
    window.SkillNestApp.render();
  }

  // Reloads the open thread; re-renders only when render-relevant content
  // changed. readAt is excluded from the comparison — it isn't rendered, and
  // the server stamping it (own open, or the counterpart reading) would
  // otherwise force a spurious re-render on every poll.
  let threadReloadInFlight = false;
  async function reloadActiveThread() {
    const id = messagingThread.conversationId;
    if (!id || threadReloadInFlight) return;
    threadReloadInFlight = true;
    const data = await backendFetch(`/api/messages/conversations/${id}`);
    threadReloadInFlight = false;
    if (!data?.ok || messagingThread.conversationId !== id) return;
    const fingerprint = (msgs) => JSON.stringify((msgs || []).map(({ readAt, ...rest }) => rest));
    const changed = fingerprint(data.messages) !== fingerprint(messagingThread.messages);
    messagingThread = { conversationId: id, conversation: data.conversation, messages: data.messages || [], loading: false };
    if (changed) {
      rerenderPreservingCompose();
      if (data.conversation.unreadCount > 0) {
        await backendFetch(`/api/messages/conversations/${id}/read`, { method: "POST" });
        refreshConversations();
      }
    }
  }

  async function sendChatMessage(event) {
    event.preventDefault();
    const input = document.getElementById("chatComposeInput");
    const text = (input?.value || "").trim();
    const id = messagingThread.conversationId;
    if (!text || !id) return;
    if (input) input.value = "";

    const result = await backendFetch(`/api/messages/conversations/${id}`, { method: "POST", body: { body: text } });
    if (!result?.ok) {
      const retry = document.getElementById("chatComposeInput");
      if (retry) retry.value = text;
      window.alert(result?.error || "That message couldn't be sent. Is the server running?");
      return;
    }
    await reloadActiveThread();
    refreshConversations();
  }

  function openNewMessage(to = "", hatchId = "", hatchTitle = "") {
    window.SkillNestApp.openModal(C.newMessageModal({ to, hatchId, hatchTitle }));
    window.setTimeout(() => (document.getElementById(to ? "newMessageBody" : "newMessageTo") || document.getElementById("newMessageBody"))?.focus(), 60);
  }

  // "Message <poster>" on a browse card's detail modal.
  function openNewMessageForTask(taskId) {
    const task = window.SkillNestApp.findAnyTask(taskId);
    if (!task?.backendId || !task.createdByUsername) return;
    window.SkillNestApp.closeModal();
    openNewMessage(task.createdByUsername, task.backendId, task.title || "");
  }

  // "Message client / Message Operator" on profile rows: the server resolves
  // the other party from the hatch, so no local knowledge of who claimed it
  // is needed.
  function openNewMessageForHatch(backendId) {
    const known = [...getPostedTasks(), ...getMissions()].find((item) => item.backendId === backendId);
    openNewMessage("", backendId, known?.title || "");
  }

  // ── New-message recipient typeahead ────────────────────────────────────────
  // The composer autocompletes against the operator + client directory. Each
  // person's id doubles as their messaging handle (same value the "Message X"
  // buttons already send), so picking one just fills the "To" field with it.
  function messageablePeople() {
    const seen = new Set();
    return [...operators, ...clients].filter((person) => {
      if (!person || !person.id || seen.has(person.id)) return false;
      seen.add(person.id);
      return true;
    });
  }

  // Rank matches: whole-name/handle prefix beats a word prefix beats a
  // substring beats a tool match, so the closest names surface first.
  function matchPeople(query, limit = 6) {
    const needle = String(query || "").trim().toLowerCase().replace(/^@+/, "");
    if (!needle) return [];
    const scored = [];
    for (const person of messageablePeople()) {
      const name = String(person.name || "").toLowerCase();
      const handle = String(person.id || "").toLowerCase();
      const tools = (person.tools || []).join(" ").toLowerCase();
      let score = 0;
      if (handle.startsWith(needle) || name.startsWith(needle)) score = 4;
      else if (name.split(/\s+/).some((word) => word.startsWith(needle))) score = 3;
      else if (name.includes(needle) || handle.includes(needle)) score = 2;
      else if (tools.includes(needle)) score = 1;
      if (score > 0) scored.push({ person, score });
    }
    return scored
      .sort((a, b) => b.score - a.score || String(a.person.name).localeCompare(String(b.person.name)))
      .slice(0, limit)
      .map((entry) => entry.person);
  }

  let recipientMatches = [];
  let recipientActiveIndex = -1;

  function hideRecipientMenu() {
    const input = document.getElementById("newMessageTo");
    const menu = document.getElementById("newMessageSuggestions");
    if (menu) { menu.hidden = true; menu.innerHTML = ""; }
    if (input) input.setAttribute("aria-expanded", "false");
    recipientMatches = [];
    recipientActiveIndex = -1;
  }

  function onRecipientInput() {
    const input = document.getElementById("newMessageTo");
    const menu = document.getElementById("newMessageSuggestions");
    if (!input || !menu) return;
    const matches = matchPeople(input.value, 6);
    recipientMatches = matches;
    recipientActiveIndex = -1;
    if (!matches.length) { hideRecipientMenu(); return; }
    menu.innerHTML = C.messageSuggestionList(matches);
    menu.hidden = false;
    input.setAttribute("aria-expanded", "true");
  }

  function highlightRecipient(index) {
    const menu = document.getElementById("newMessageSuggestions");
    if (!menu) return;
    const options = [...menu.querySelectorAll(".mention-option")];
    options.forEach((el, i) => {
      const on = i === index;
      el.classList.toggle("active", on);
      el.setAttribute("aria-selected", on ? "true" : "false");
      if (on) el.scrollIntoView({ block: "nearest" });
    });
    recipientActiveIndex = index;
  }

  function onRecipientKeydown(event) {
    const menu = document.getElementById("newMessageSuggestions");
    const open = menu && !menu.hidden && recipientMatches.length;
    if (!open) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      highlightRecipient((recipientActiveIndex + 1) % recipientMatches.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      highlightRecipient((recipientActiveIndex - 1 + recipientMatches.length) % recipientMatches.length);
    } else if (event.key === "Enter" && recipientActiveIndex >= 0) {
      event.preventDefault(); // choose the highlighted person instead of submitting
      pickMessageRecipient(recipientMatches[recipientActiveIndex].id);
    } else if (event.key === "Escape") {
      hideRecipientMenu();
    }
  }

  // Fires on blur; a row's cancelled mousedown keeps focus, so a click on a
  // suggestion runs pickMessageRecipient before this can hide the menu.
  function onRecipientBlur() {
    hideRecipientMenu();
  }

  function pickMessageRecipient(id) {
    const input = document.getElementById("newMessageTo");
    if (input) input.value = id;
    hideRecipientMenu();
    document.getElementById("newMessageBody")?.focus();
  }

  async function sendNewMessage(event) {
    event.preventDefault();
    const to = document.getElementById("newMessageTo")?.value.trim() || "";
    const hatchId = document.getElementById("newMessageHatchId")?.value.trim() || "";
    const body = document.getElementById("newMessageBody")?.value.trim() || "";
    if (!body || (!to && !hatchId)) return;

    const payload = { body };
    if (to) payload.to = to;
    if (hatchId) payload.hatchId = hatchId;
    const result = await backendFetch("/api/messages/start", { method: "POST", body: payload });
    if (!result?.ok) {
      window.alert(result?.error || "That message couldn't be sent. Is the server running?");
      return;
    }
    window.SkillNestApp.closeModal();
    refreshConversations();
    openConversation(result.conversation.id);
  }

  async function archiveConversation(id, archived) {
    const result = await backendFetch(`/api/messages/conversations/${Number(id)}/${archived ? "archive" : "unarchive"}`, { method: "POST" });
    if (!result?.ok) {
      window.alert(result?.error || "That change couldn't be saved. Is the server running?");
      return;
    }
    if (messagingThread.conversation && messagingThread.conversationId === Number(id)) {
      messagingThread.conversation.archived = archived;
    }
    await refreshConversations();
    window.SkillNestApp.render();
  }

  // Poll for new activity so the nav badge and an open thread stay fresh
  // without websockets. Cache comparisons keep quiet polls render-free.
  window.setInterval(() => {
    if (!isLoggedIn() || !backendToken()) return;
    refreshMessagesUnread();
    if (currentRoute() === "messages") {
      refreshConversations();
      reloadActiveThread();
    }
  }, 20000);

  return {
    getMessagingThread,
    getMessagingFilter,
    getConversations,
    getMessagesUnread,
    clearMessagingState,
    refreshConversations,
    reloadActiveThread,
    openConversation,
    closeThread,
    setMessagesFilter,
    sendChatMessage,
    openNewMessage,
    openNewMessageForTask,
    openNewMessageForHatch,
    onRecipientInput,
    onRecipientKeydown,
    onRecipientBlur,
    pickMessageRecipient,
    sendNewMessage,
    archiveConversation,
  };
})());
