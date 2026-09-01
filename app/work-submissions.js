// Split out of app.js: mission tracking (save/complete/remove), the
// Operator work-submission flow, the poster's review flow, and publishing
// an approved delivery to Verified Results. Depends on app/theme-language.js,
// app/backend-client.js, app/task-store.js, and app/intake-assistant.js
// (readFileAsDataUrl), all loaded earlier. findAnyTask, closeModal,
// openModal, render, and refreshConversations are still defined later in
// the app.js trunk, so those calls go through window.SkillNestApp.foo()
// instead of a destructure.
window.SkillNestApp = window.SkillNestApp || {};
Object.assign(window.SkillNestApp, (() => {
  const { completedHatches } = window.SkillNestData;
  const C = window.SkillNestComponents;
  const {
    isLoggedIn, setRoute, backendFetch, backendToken, getAccount, getMissions, getPostedTasks,
    missionsKey, postedTasksKey, readJson, saveListItem, trySetLocalStorage, readFileAsDataUrl,
  } = window.SkillNestApp;

  // Caps each attached file so it fits safely in localStorage as base64.
  // Mirrors the same constant in app/intake-assistant.js (handleTaskFiles) —
  // both attach-file flows share the limit, but not the closure.
  const MAX_DRAFT_FILE_BYTES = 3 * 1024 * 1024;

  async function saveMission(taskId, status) {
    if (!isLoggedIn()) {
      localStorage.setItem("hatchPendingMission", JSON.stringify({ taskId, status }));
      setRoute("auth");
      return;
    }
    const task = window.SkillNestApp.findAnyTask(taskId);
    if (!task) return;
    if (C.statusInfo(task.status).label === "Hatched") return;

    // Applying to a Hatch (Incubating) claims it on the backend when possible so
    // the deliverable the Operator submits later actually reaches the poster. If
    // the task has no backendId (seed tasks) or the server is unreachable, the
    // mission is still saved locally and the demo flow keeps working.
    let backendId = task.backendId || null;
    let backendState = task.backendState || null;
    const applying = status === "Incubating" || status === "Accepted";
    if (applying && backendId && backendToken()) {
      const result = await backendFetch(`/api/hatches/${encodeURIComponent(backendId)}/claim`, { method: "POST" });
      if (result?.ok && result.hatch) {
        backendState = result.hatch.state || "claimed";
      } else if (result?.hatch?.state) {
        // Already claimed (e.g. re-applying) — keep the reported state.
        backendState = result.hatch.state;
      }
    }

    saveListItem(
      missionsKey(),
      { ...task, status, backendId, backendState, updatedAt: new Date().toISOString() },
      "id"
    );
    updateTaskCardState(taskId, status);
    const feedback = document.getElementById("taskFeedback");
    if (feedback) {
      feedback.textContent = applying ? "Hatch added to your Operator Hatches." : "Hatch saved to your profile.";
      feedback.classList.add("show");
    }
  }

  function completePendingMission() {
    const pending = readJson("hatchPendingMission", null);
    if (!pending?.taskId) return false;
    const task = window.SkillNestApp.findAnyTask(pending.taskId);
    localStorage.removeItem("hatchPendingMission");
    if (!task) return false;
    if (C.statusInfo(task.status).label === "Hatched") return false;
    const status = pending.status || "Saved";
    saveListItem(missionsKey(), { ...task, status, updatedAt: new Date().toISOString() }, "id");
    localStorage.setItem(
      "hatchProfileNotice",
      status === "Incubating" || status === "Accepted"
        ? "Hatch added to your Operator Hatches."
        : "Hatch saved to your profile."
    );
    setRoute("profile");
    return true;
  }

  function updateTaskCardState(taskId, status) {
    document.querySelectorAll(`[data-task-id="${taskId}"]`).forEach((card) => {
      card.classList.add(status === "Incubating" || status === "Accepted" ? "mission-accepted" : "mission-saved");
      const saveButton = card.querySelector(".save-action");
      const applyButton = card.querySelector(".apply-action");
      if (saveButton) saveButton.textContent = "Saved";
      if (applyButton && (status === "Incubating" || status === "Accepted")) {
        applyButton.textContent = "Incubating";
        applyButton.disabled = true;
      }
    });
  }

  function syncMissionCardStates() {
    getMissions().forEach((mission) => {
      if (mission.id) updateTaskCardState(mission.id, mission.status);
    });
  }

  function removeMission(identifier) {
    const missions = getMissions().filter((mission) => mission.id !== identifier && encodeURIComponent(mission.title) !== identifier);
    localStorage.setItem(missionsKey(), JSON.stringify(missions));
    window.SkillNestApp.render();
  }

  // --- Work submission (Operator) and review (poster) ---------------------
  // The Operator describes the deliverable, optionally attaching files and
  // links, and submits it for the poster to review. Submissions are sent to
  // the backend when the mission was claimed there (so the poster is notified
  // and can approve/reject from any session); a local copy is always kept so
  // the flow works offline and for seed tasks with no backend row.

  function findMission(missionId) {
    return getMissions().find((mission) => mission.id === missionId);
  }

  function openSubmitWork(missionId) {
    const mission = findMission(missionId);
    if (!mission) return;
    localStorage.removeItem("hatchSubmissionDraftFiles");
    window.SkillNestApp.openModal(C.submitWorkModal(mission));
  }

  async function handleSubmissionFiles(event) {
    const input = event.target;
    const chosen = [...(input.files || [])];
    if (!chosen.length) return;

    const oversized = chosen.filter((file) => file.size > MAX_DRAFT_FILE_BYTES);
    const accepted = chosen.filter((file) => file.size <= MAX_DRAFT_FILE_BYTES);
    if (oversized.length) {
      window.alert(`${oversized.length === 1 ? "This file is" : "These files are"} over 3 MB and can't be attached: ${oversized.map((file) => file.name).join(", ")}.`);
    }
    if (!accepted.length) {
      input.value = "";
      return;
    }

    let readFiles;
    try {
      readFiles = await Promise.all(accepted.map(async (file) => ({
        name: file.name,
        type: file.type || "file",
        size: file.size || 0,
        objectUrl: await readFileAsDataUrl(file),
      })));
    } catch (error) {
      window.alert(error.message || "One of those files could not be read. Please try again.");
      input.value = "";
      return;
    }

    const existing = readJson("hatchSubmissionDraftFiles", []);
    const nextFiles = [...existing, ...readFiles];
    if (!trySetLocalStorage("hatchSubmissionDraftFiles", nextFiles)) {
      window.alert("These files are too large to attach together. Try removing one or attaching fewer at a time.");
      input.value = "";
      return;
    }
    input.value = "";
    renderSubmissionAttachments();
  }

  function removeSubmissionFile(index) {
    const files = readJson("hatchSubmissionDraftFiles", []);
    files.splice(index, 1);
    localStorage.setItem("hatchSubmissionDraftFiles", JSON.stringify(files));
    renderSubmissionAttachments();
  }

  function renderSubmissionAttachments() {
    const host = document.getElementById("submissionAttachments");
    if (host) host.innerHTML = C.submissionAttachmentList(readJson("hatchSubmissionDraftFiles", []));
  }

  async function submitWork(event, missionId) {
    event.preventDefault();
    const mission = findMission(missionId);
    if (!mission) return;

    const messageEl = document.getElementById("submissionMessage");
    const linksEl = document.getElementById("submissionLinks");
    const message = (messageEl?.value || "").trim();
    if (!message) {
      messageEl?.focus();
      return;
    }

    const links = (linksEl?.value || "")
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .map((url) => ({ name: url, kind: "link", url }));
    const files = readJson("hatchSubmissionDraftFiles", []).map((file) => ({ ...file, kind: "file" }));
    const attachments = [...files, ...links];

    let delivered = false;
    if (mission.backendId && backendToken()) {
      const result = await backendFetch(`/api/hatches/${encodeURIComponent(mission.backendId)}/submit`, {
        method: "POST",
        body: { message, attachments },
      });
      if (result && result.status && result.status >= 400) {
        window.alert(result.error || "That work couldn't be submitted to the server. It's been saved locally.");
      } else if (result?.ok) {
        delivered = true;
      }
    }

    const submission = {
      message,
      attachments,
      status: "pending",
      submittedAt: new Date().toISOString(),
      delivered,
    };
    saveListItem(
      missionsKey(),
      { ...mission, status: "In review", submission, backendState: delivered ? "submitted" : mission.backendState, updatedAt: new Date().toISOString() },
      "id"
    );

    // Local bridge: mirror the submission onto the poster's copy of this Hatch
    // so the client can review it in the same browser even when the two sides
    // never met on the backend (self-posted demo Hatches, offline, seed tasks).
    // Posted/mission lists are per-account, so this only ever matches when the
    // same logged-in account is testing both sides of one Hatch.
    const posted = getPostedTasks();
    const postedIndex = posted.findIndex((task) => task.id === mission.id || (mission.backendId && task.backendId === mission.backendId));
    if (postedIndex !== -1) {
      posted[postedIndex] = { ...posted[postedIndex], status: "In review", submission, updatedAt: new Date().toISOString() };
      localStorage.setItem(postedTasksKey(), JSON.stringify(posted));
    }

    localStorage.removeItem("hatchSubmissionDraftFiles");
    localStorage.setItem("hatchProfileNotice", delivered
      ? "Work submitted. The client has been notified and can review it."
      : "Work submitted and saved to this Hatch.");
    window.SkillNestApp.closeModal();
    window.SkillNestApp.refreshConversations();
    window.SkillNestApp.render();
  }

  function openReviewWork(postedId) {
    const task = getPostedTasks().find((item) => item.id === postedId || encodeURIComponent(item.title) === postedId);
    if (!task) return;

    if (task.backendId && backendToken()) {
      backendFetch(`/api/hatches/${encodeURIComponent(task.backendId)}`).then((result) => {
        const remote = Array.isArray(result?.submissions)
          ? [...result.submissions].reverse().find((sub) => sub.status === "pending") || result.submissions[result.submissions.length - 1]
          : null;
        window.SkillNestApp.openModal(C.reviewWorkModal(task, remote || task.submission || null));
      });
      return;
    }
    window.SkillNestApp.openModal(C.reviewWorkModal(task, task.submission || null));
  }

  async function reviewWork(postedId, decision) {
    const task = getPostedTasks().find((item) => item.id === postedId || encodeURIComponent(item.title) === postedId);
    if (!task) return;
    const feedback = (document.getElementById("reviewFeedback")?.value || "").trim();
    const approving = decision === "approve";
    // Opt-in from the review modal: publish the finished project + delivered
    // result to Verified Results. Only meaningful on approval.
    const publishToVerified = approving && document.getElementById("reviewPublish")?.checked;

    if (task.backendId && backendToken()) {
      const result = await backendFetch(`/api/hatches/${encodeURIComponent(task.backendId)}/review`, {
        method: "POST",
        body: { decision: approving ? "approve" : "reject", feedback },
      });
      if (result && result.status && result.status >= 400) {
        window.alert(result.error || "That review couldn't be sent to the server.");
      }
    }

    const reviewedSubmission = task.submission
      ? { ...task.submission, status: approving ? "approved" : "rejected", feedback: feedback || task.submission.feedback, reviewedAt: new Date().toISOString() }
      : task.submission;
    saveListItem(
      postedTasksKey(),
      { ...task, status: approving ? "Hatched" : "Incubating", submission: reviewedSubmission, updatedAt: new Date().toISOString() },
      "id"
    );

    // Local bridge back to the Operator's copy so their mission reflects the
    // decision (Hatched on approve, back to Incubating to revise on reject).
    // Only matches when the same account is testing both sides (see submitWork).
    const missions = getMissions();
    const missionIndex = missions.findIndex((mission) => mission.id === task.id || (task.backendId && mission.backendId === task.backendId));
    if (missionIndex !== -1) {
      missions[missionIndex] = { ...missions[missionIndex], status: approving ? "Hatched" : "Incubating", submission: reviewedSubmission, updatedAt: new Date().toISOString() };
      localStorage.setItem(missionsKey(), JSON.stringify(missions));
    }

    if (publishToVerified) publishVerifiedResult(task, reviewedSubmission);

    localStorage.setItem("hatchProfileNotice", approving
      ? (publishToVerified
        ? "Submission approved. This Hatch is now Hatched and published to Verified Results."
        : "Submission approved. This Hatch is now Hatched.")
      : "Changes requested. The Operator has been asked to revise.");
    window.SkillNestApp.closeModal();
    window.SkillNestApp.refreshConversations();
    window.SkillNestApp.render();
  }

  // Reads the client-published completed Hatches shown on the Verified Results
  // page (newest first). Separate from the seeded completedHatches demo data.
  function getPublishedResults() {
    return readJson("hatchPublishedResults", []);
  }

  // Turns an approved task + its submission into a Verified Results record so
  // visitors can see the project and exactly what the Operator handed in. Shaped
  // to render through the same verifiedWorkCard / verifiedProjectDetail as the
  // seed data, but carries a plain operatorName (no seeded profile) plus the
  // delivered submission (message + attachments).
  function publishVerifiedResult(task, submission) {
    const account = getAccount();
    const operatorName = account.name || account.username || "Operator";
    const initials = operatorName
      .split(/\s+/)
      .map((word) => word[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "H";
    const level = task.level || "L1";
    const industry = task.industry || task.category || "General";
    const record = {
      id: `published-${task.backendId || task.id}`,
      title: task.title || "Completed Hatch",
      clientContext: task.business ? `Delivered for ${task.business}.` : (task.summary || task.objective || "Client-approved delivery."),
      objective: task.objective || task.summary || "Deliver a clear, usable result for the client.",
      scope: Array.isArray(task.scope) ? task.scope : [],
      deliverables: Array.isArray(task.deliverables) ? task.deliverables : [],
      industry,
      category: task.category || industry,
      level,
      amountEarned: task.budget || "—",
      completionTime: "on schedule",
      rating: "New",
      outcome: submission?.message || "Delivered work approved by the client.",
      completedAt: new Date().toISOString().slice(0, 10),
      verifiedBadges: ["Client accepted", "Completed"],
      operatorId: null,
      operatorName,
      operatorInitials: initials,
      operatorMeta: `${level} · ${industry}`,
      showProfile: true,
      showEarnings: Boolean(task.budget),
      showCompletionTime: true,
      published: true,
      submission: submission
        ? { message: submission.message || "", attachments: Array.isArray(submission.attachments) ? submission.attachments : [] }
        : null,
    };
    const list = getPublishedResults().filter((item) => item.id !== record.id);
    list.unshift(record);
    localStorage.setItem("hatchPublishedResults", JSON.stringify(list));
  }

  function deletePostedTask(identifier) {
    if (!window.confirm("Delete this posted Hatch?")) return;
    const target = getPostedTasks().find((task) => task.id === identifier || encodeURIComponent(task.title) === identifier);
    const postedTasks = getPostedTasks().filter((task) => task.id !== identifier && encodeURIComponent(task.title) !== identifier);
    localStorage.setItem(postedTasksKey(), JSON.stringify(postedTasks));
    // Clean up the backend mirror too: admins delete outright, owners cancel.
    if (target?.backendId && backendToken()) {
      const path = `/api/hatches/${encodeURIComponent(target.backendId)}`;
      backendFetch(path, { method: "DELETE" }).then((result) => {
        if (!result?.ok) backendFetch(`${path}/cancel`, { method: "POST" });
      });
    }
    window.SkillNestApp.render();
  }

  return {
    saveMission,
    completePendingMission,
    syncMissionCardStates,
    removeMission,
    openSubmitWork,
    handleSubmissionFiles,
    removeSubmissionFile,
    submitWork,
    openReviewWork,
    reviewWork,
    getPublishedResults,
    deletePostedTask,
  };
})());
