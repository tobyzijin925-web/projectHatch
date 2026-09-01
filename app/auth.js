// Split out of app.js: login/signup/logout and the post-auth routing that
// resumes whatever the visitor was doing before being asked to sign in
// (a pending Hatch submission, a pending message, or a pending mission
// claim). Depends on app/theme-language.js and app/backend-client.js
// (loaded earlier) plus app/intake-assistant.js's submitReviewedHatch and
// accountRoute (also loaded earlier, already exported from there).
// clearMessagingState, completePendingMission, messageOperator, and render
// are still defined later in the app.js trunk, so those calls go through
// window.SkillNestApp.foo() instead of a destructure.
window.SkillNestApp = window.SkillNestApp || {};
Object.assign(window.SkillNestApp, (() => {
  const Pages = window.SkillNestPages;
  const {
    setRoute, backendFetch, backendPassword, backendToken, getAccount, storeBackendSession,
    accountRoute, submitReviewedHatch,
  } = window.SkillNestApp;

  function finishAuth(account) {
    localStorage.setItem("skillnestLoggedIn", "true");
    if (localStorage.getItem("hatchPendingSubmit") === "true") {
      submitReviewedHatch();
      return;
    }
    const pendingMessageTo = localStorage.getItem("hatchPendingMessageTo");
    if (pendingMessageTo) {
      localStorage.removeItem("hatchPendingMessageTo");
      setRoute(accountRoute(account));
      window.setTimeout(() => window.SkillNestApp.messageOperator(pendingMessageTo), 60);
      return;
    }
    if (window.SkillNestApp.completePendingMission()) return;
    setRoute(accountRoute(account));
  }

  async function completeLogin(event) {
    event.preventDefault();
    const local = getAccount();
    const usernameOrEmail = document.getElementById("loginUsername").value.trim();
    const password = document.getElementById("loginPassword").value;

    // Backend first, so the session carries server truth (role, isAdmin).
    const result = await backendFetch("/api/auth/login", {
      method: "POST",
      body: { usernameOrEmail, password: backendPassword(password) },
    });
    if (result?.ok) {
      storeBackendSession(result, { password });
      finishAuth(getAccount());
      return;
    }

    // Backend down or unknown account: legacy local check.
    const matchesIdentity = usernameOrEmail === local.username || usernameOrEmail === local.email;
    const matchesPassword = !local.password || password === local.password;
    if (!matchesIdentity || !matchesPassword) {
      document.getElementById("loginError")?.classList.add("show");
      return;
    }
    // Local-only account against a live backend: migrate it so the account
    // (and its inbox) exists server-side from now on.
    if (result !== null) {
      const migrated = await backendFetch("/api/auth/signup", {
        method: "POST",
        body: {
          username: local.username,
          name: local.name,
          email: local.email,
          password: backendPassword(password || local.password || local.username),
          role: local.role,
        },
      });
      if (migrated?.ok) storeBackendSession(migrated, { password });
    }
    finishAuth(getAccount());
  }

  async function completeSignup(event) {
    event.preventDefault();
    // The checkbox is `required`, so the browser normally blocks submit before
    // we get here — but guard anyway in case the field is ever bypassed.
    const termsBox = document.getElementById("authTerms");
    if (termsBox && !termsBox.checked) {
      termsBox.reportValidity?.();
      return;
    }
    const account = {
      username: document.getElementById("authUsername").value.trim(),
      name: document.getElementById("authName").value.trim(),
      email: document.getElementById("authEmail").value.trim(),
      password: document.getElementById("authPassword").value,
      role: document.getElementById("authRole").value,
      joinedAt: new Date().toISOString(),
      // Record consent so it's tied to the version of the terms shown at signup.
      acceptedTermsAt: new Date().toISOString(),
      termsVersion: Pages.LEGAL_VERSION,
    };

    // Language preferences chosen during setup, stored on the account so they
    // follow the user rather than the device.
    const prefs = window.HatchI18n?.setPrefs({
      contentLanguage: document.getElementById("authLanguage")?.value,
      foreignHatches: document.querySelector('input[name="authForeignHatches"]:checked')?.value,
    });
    if (prefs) {
      account.contentLanguage = prefs.contentLanguage;
      account.foreignHatches = prefs.foreignHatches;
    }

    localStorage.setItem("skillnestAccount", JSON.stringify(account));

    let result = await backendFetch("/api/auth/signup", {
      method: "POST",
      body: { ...account, password: backendPassword(account.password) },
    });
    // Already registered on the backend (e.g. new browser): sign in instead.
    if (result && !result.ok) {
      result = await backendFetch("/api/auth/login", {
        method: "POST",
        body: { usernameOrEmail: account.username || account.email, password: backendPassword(account.password) },
      });
    }
    if (result?.ok) storeBackendSession(result, { password: account.password });
    finishAuth(getAccount());
  }

  async function quickTestLogin() {
    const account = {
      username: "test_operator",
      name: "Test Operator",
      email: "test@hatch.local",
      password: "test",
      role: "Client and Operator",
      provider: "Quick test login",
      joinedAt: new Date().toISOString(),
    };
    localStorage.setItem("skillnestAccount", JSON.stringify(account));
    let result = await backendFetch("/api/auth/login", {
      method: "POST",
      body: { usernameOrEmail: account.username, password: backendPassword(account.password) },
    });
    if (result && !result.ok) {
      result = await backendFetch("/api/auth/signup", {
        method: "POST",
        body: { ...account, password: backendPassword(account.password) },
      });
    }
    if (result?.ok) storeBackendSession(result, { password: account.password, provider: account.provider });
    localStorage.setItem("skillnestLoggedIn", "true");
    if (localStorage.getItem("hatchPendingSubmit") === "true") {
      submitReviewedHatch();
      return;
    }
    if (window.SkillNestApp.completePendingMission()) return;
    setRoute("profile");
  }

  function socialLogin() {
    document.getElementById("loginError")?.classList.add("show");
  }

  function logout() {
    if (backendToken()) backendFetch("/api/auth/logout", { method: "POST" });
    localStorage.removeItem("hatchAuthToken");
    localStorage.removeItem("skillnestLoggedIn");
    window.SkillNestApp.clearMessagingState();
    setRoute("home");
    window.SkillNestApp.render();
  }

  return {
    finishAuth,
    completeLogin,
    completeSignup,
    quickTestLogin,
    socialLogin,
    logout,
  };
})());
