// Theme handling. Runs without Blazor interactivity so it also works on statically rendered pages.
(function () {
    const key = "dotnet11lab-theme";
    const preferred = () => localStorage.getItem(key)
        || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const apply = () => document.documentElement.setAttribute("data-theme", preferred());
    window.dotnet11lab = window.dotnet11lab || {};
    window.dotnet11lab.toggleTheme = function () {
        const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
        localStorage.setItem(key, next);
        apply();
    };
    window.dotnet11lab.copyCode = function (button) {
        const code = button.closest(".code").querySelector("pre").innerText;
        navigator.clipboard.writeText(code).then(() => {
            const old = button.textContent; button.textContent = "Copied"; setTimeout(() => button.textContent = old, 1200);
        });
    };
    apply();
    // Enhanced navigation patches the DOM; re-apply the theme after each enhanced page load.
    document.addEventListener("DOMContentLoaded", () => {
        if (window.Blazor && window.Blazor.addEventListener) window.Blazor.addEventListener("enhancedload", apply);
    });
})();
