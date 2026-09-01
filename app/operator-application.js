// Split out of app.js: the "Become an Operator" wizard (account/about/focus
// steps, resume attach, submit) and pulling reviewed application status back
// from the backend. Depends on app/theme-language.js and
// app/backend-client.js, loaded earlier. finishOperatorWizard and render are
// still defined later in the app.js trunk, so those calls go through
// window.SkillNestApp.foo() instead of a destructure.
window.SkillNestApp = window.SkillNestApp || {};
Object.assign(window.SkillNestApp, (() => {
  const {
    readJson, getAccount, getOperatorApplications, isLoggedIn, setRoute, backendToken, backendFetch,
  } = window.SkillNestApp;

  function getOperatorWizard() {
    return {
      step: localStorage.getItem("hatchOperatorStep") || "account",
      draft: readJson("hatchOperatorDraft", {}),
    };
  }

  function saveOperatorWizard(step, draft) {
    localStorage.setItem("hatchOperatorStep", step);
    localStorage.setItem("hatchOperatorDraft", JSON.stringify(draft));
  }

  function collectChoices(form, name) {
    const values = [...form.querySelectorAll(`[name="${name}"].selected`)].map((button) => button.value);
    const other = form.querySelector(`[name="${name}Other"]`)?.value.trim();
    if (other && !values.includes(other)) values.push(other);
    return values;
  }

  // Snapshots what the focus step currently holds so a re-render (e.g. after
  // attaching a resume) doesn't wipe the other fields the applicant filled in.
  function captureFocusDraft(baseDraft = getOperatorWizard().draft) {
    const form = document.querySelector(".operator-focus-form");
    if (!form) return baseDraft;
    return {
      ...baseDraft,
      industries: collectChoices(form, "industries"),
      exampleTasks: collectChoices(form, "exampleTasks"),
      linkedin: document.getElementById("operatorLinkedin")?.value.trim() ?? baseDraft.linkedin ?? "",
    };
  }

  // Rebuilds the wizard draft from a submitted application and jumps straight
  // into it — so "Update application" resumes with everything pre-filled
  // instead of starting a blank re-application.
  function updateOperatorApplication() {
    const account = getAccount();
    const application = getOperatorApplications()[0];
    const splitList = (value) => String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
    const draft = application
      ? {
        name: application.name || account.name || "",
        background: splitList(application.background),
        tools: splitList(application.tools),
        industries: splitList(application.industries),
        exampleTasks: splitList(application.exampleTasks),
        linkedin: application.linkedin || "",
        resumeName: application.resumeName || "",
        resumeData: application.resumeData || "",
      }
      : { name: account.name || "" };
    // Logged-in applicants already have an account, so skip that step.
    saveOperatorWizard(isLoggedIn() ? "about" : "account", draft);
    setRoute("operator");
  }

  function attachResume(event) {
    const input = event.currentTarget;
    const file = input.files && input.files[0];
    if (!file) return;
    // 2 MB keeps the data URL within the localStorage budget and the backend
    // body limit once base64-expanded.
    if (file.size > 2 * 1024 * 1024) {
      window.alert("That resume is over 2 MB. Please choose a smaller file.");
      input.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const draft = captureFocusDraft();
      draft.resumeName = file.name;
      draft.resumeData = String(reader.result || "");
      saveOperatorWizard("focus", draft);
      window.SkillNestApp.render();
    };
    reader.onerror = () => window.alert("That resume could not be read. Please try another file.");
    reader.readAsDataURL(file);
  }

  function removeResume() {
    const draft = captureFocusDraft();
    delete draft.resumeName;
    delete draft.resumeData;
    saveOperatorWizard("focus", draft);
    window.SkillNestApp.render();
  }

  // Selecting "Become an Operator" makes you an Operator — so normalize any prior
  // role up to include Operator rather than dropping into an application flow.
  function operatorRoleFor(role) {
    if (!role) return "Operator";
    if (role.includes("Operator")) return role;
    if (role.includes("Client")) return "Client and Operator";
    return "Operator";
  }

  function operatorAccountStep(event) {
    event.preventDefault();
    const email = document.getElementById("operatorAuthEmail").value.trim();
    const password = document.getElementById("operatorAuthPassword").value;
    const existing = getAccount();
    const sameEmail = existing.email === email;
    const account = {
      username: sameEmail && existing.username ? existing.username : email.split("@")[0],
      name: sameEmail ? existing.name || "" : "",
      email,
      password,
      role: operatorRoleFor(sameEmail ? existing.role : ""),
      provider: "Email",
      joinedAt: sameEmail && existing.joinedAt ? existing.joinedAt : new Date().toISOString(),
    };
    localStorage.setItem("skillnestAccount", JSON.stringify(account));
    localStorage.setItem("skillnestLoggedIn", "true");
    // Instant Operator — no application step. Land straight on the profile.
    window.SkillNestApp.finishOperatorWizard("profile");
  }

  function operatorGoogleSignup() {
    const existing = getAccount();
    const account = existing.email
      ? { ...existing, role: operatorRoleFor(existing.role), provider: "Google (simulated)" }
      : {
        username: "google_operator",
        name: "",
        email: "operator@gmail.com",
        password: "",
        role: "Operator",
        provider: "Google (simulated)",
        joinedAt: new Date().toISOString(),
      };
    localStorage.setItem("skillnestAccount", JSON.stringify(account));
    localStorage.setItem("skillnestLoggedIn", "true");
    // Instant Operator — no application step. Land straight on the profile.
    window.SkillNestApp.finishOperatorWizard("profile");
  }

  function operatorContinueLoggedIn() {
    // Already signed in — just make sure the account carries the Operator role,
    // then land on the profile. No application step.
    const account = getAccount();
    const role = operatorRoleFor(account.role);
    if (role !== account.role) {
      localStorage.setItem("skillnestAccount", JSON.stringify({ ...account, role }));
    }
    window.SkillNestApp.finishOperatorWizard("profile");
  }

  function operatorStepNext(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const draft = {
      ...getOperatorWizard().draft,
      name: document.getElementById("operatorName")?.value.trim() || "",
      background: collectChoices(form, "background"),
      tools: collectChoices(form, "tools"),
    };
    saveOperatorWizard("focus", draft);
    window.SkillNestApp.render();
  }

  function operatorStepBack(event) {
    const form = event.target.closest("form");
    const { step, draft } = getOperatorWizard();
    if (step === "focus") {
      saveOperatorWizard("about", {
        ...draft,
        industries: collectChoices(form, "industries"),
        exampleTasks: collectChoices(form, "exampleTasks"),
        linkedin: document.getElementById("operatorLinkedin")?.value.trim() ?? draft.linkedin ?? "",
      });
    } else {
      saveOperatorWizard("account", {
        ...draft,
        name: document.getElementById("operatorName")?.value.trim() || draft.name || "",
        background: collectChoices(form, "background"),
        tools: collectChoices(form, "tools"),
      });
    }
    window.SkillNestApp.render();
  }

  function submitOperator(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const account = getAccount();
    const { draft } = getOperatorWizard();
    const application = {
      id: `operator-${Date.now()}`,
      name: draft.name || account.name || account.username || "",
      email: account.email || "",
      background: (draft.background || []).join(", "),
      tools: (draft.tools || []).join(", "),
      industries: collectChoices(form, "industries").join(", "),
      exampleTasks: collectChoices(form, "exampleTasks").join(", "),
      linkedin: document.getElementById("operatorLinkedin")?.value.trim() || draft.linkedin || "",
      resumeName: draft.resumeName || "",
      resumeData: draft.resumeData || "",
      status: "Submitted",
      submittedAt: new Date().toISOString(),
    };
    if (draft.name && !account.name) {
      localStorage.setItem("skillnestAccount", JSON.stringify({ ...account, name: draft.name }));
    }
    // One current application per person (the backend enforces the same), so an
    // update replaces the stored row rather than stacking a new one. Carry the
    // backend id over so refreshes keep tracking the same server record.
    const previous = getOperatorApplications()[0];
    if (previous?.backendId) application.backendId = previous.backendId;
    localStorage.setItem("skillnestOperatorApplications", JSON.stringify([application]));
    // Mirror to the backend queue so the admin can approve or reject it.
    if (backendToken()) {
      backendFetch("/api/hatcher-applications", { method: "POST", body: application }).then((result) => {
        if (!result?.ok) return;
        localStorage.setItem("skillnestOperatorApplications", JSON.stringify([{
          ...application,
          backendId: result.application.id,
          status: "Pending review",
        }]));
        window.SkillNestApp.render();
      });
    }
    saveOperatorWizard("done", {});
    window.SkillNestApp.render();
  }

  // Pulls the reviewed status (approved/rejected + admin note) back into the
  // local application list shown on the profile.
  async function refreshApplicationStatus() {
    if (!backendToken()) return;
    const data = await backendFetch("/api/hatcher-applications");
    if (!data?.ok || !data.applications?.length) return;
    const local = getOperatorApplications();
    const statusLabel = { pending: "Pending review", approved: "Approved", rejected: "Not approved" };
    let changed = false;
    const next = local.map((application) => {
      const remote = data.applications.find((item) => item.id === application.backendId)
        || data.applications[0];
      const label = statusLabel[remote.status] || application.status;
      // Normalize every value we might store (the backend sends null for an
      // unset review note; we keep "") and prefer whatever the applicant
      // attached locally, falling back to the server copy.
      const reviewNote = remote.reviewNote || "";
      const linkedin = application.linkedin || remote.linkedin || "";
      const resumeName = application.resumeName || remote.resumeName || "";
      const resumeData = application.resumeData || remote.resumeData || "";
      // Compare against the SAME normalized values we would store, so a
      // null-vs-"" difference can't flip `changed` on every pass and spin
      // render() -> refresh -> render() forever.
      if ((application.backendId ?? null) !== (remote.id ?? null)
        || application.status !== label
        || (application.reviewNote || "") !== reviewNote
        || (application.linkedin || "") !== linkedin
        || (application.resumeName || "") !== resumeName) {
        changed = true;
        return { ...application, backendId: remote.id, status: label, reviewNote, linkedin, resumeName, resumeData };
      }
      return application;
    });
    if (changed) {
      localStorage.setItem("skillnestOperatorApplications", JSON.stringify(next));
      window.SkillNestApp.render();
    }
  }

  return {
    getOperatorWizard,
    updateOperatorApplication,
    attachResume,
    removeResume,
    operatorAccountStep,
    operatorGoogleSignup,
    operatorContinueLoggedIn,
    operatorStepNext,
    operatorStepBack,
    submitOperator,
    refreshApplicationStatus,
  };
})());
