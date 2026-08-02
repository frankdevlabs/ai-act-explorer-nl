/**
 * The one MCP Apps UI resource on this server (roadmap 4.2, ported from
 * dora-explorer-nl's entity panel): the AI Act self-assessment
 * (data/questionnaire/assessment-v1.json) as an interactive panel.
 *
 * Four constraints shape everything below.
 *
 * 1. **Single file.** The MCP Apps iframe is sandboxed with a deny-by-default
 *    CSP, so no external script, style, font or image can load. Everything —
 *    CSS, JS and the questionnaire itself — is inlined in the document this
 *    module returns.
 * 2. **The questionnaire is the data island, not a transcription.** The whole
 *    JSON is embedded once and the DOM is built from it at runtime, so the
 *    panel cannot drift from `assessment-v1.json` and every question id is
 *    present by construction (which is what verify-mcp.ts pins).
 * 3. **The scoring engine is mirrored, not imported.** Unlike the dora panel,
 *    this one has to show rol + risicoclassificatie, which means evaluating
 *    the same forward pass `src/lib/assessment/engine.ts` runs — and a browser
 *    iframe cannot import the CommonJS build. So `PANEL_ENGINE` below is a
 *    line-for-line mirror of `computeVisibility` + the classification half of
 *    `evaluate`, bracketed by sentinel comments. `scripts/verify-mcp.ts` slices
 *    it out of the *served* HTML, evals it, and asserts it agrees with
 *    `engine.ts` on every fixture in `scripts/lib/assessment-fixtures.ts`.
 *    **Intended failure mode:** change the engine without changing the mirror
 *    and `npm run verify:mcp` goes red. Fix the mirror, do not loosen the gate.
 *    (The mirror deliberately stops where the engine's *editorial* half begins:
 *    the obligation checklist, the register row and the timeline stay on the
 *    site and in `get_obligations` / `/assessment`.)
 * 4. **Write-back is a capability, not an assumption.** `caps` tells the panel
 *    whether this deployment has a state file (`get_assessment`) and a
 *    credential (`put_assessment`). The public read deployment has neither and
 *    renders exactly the same form with the two buttons absent — no error, no
 *    dead control. Both env vars are read per call by the caller, so one build
 *    serves both stances.
 *
 * This file lives in `mcp/src/`, not `mcp/src/core/`: it imports the repo's
 * `Questionnaire` type and knows about site routes.
 */
import type { Questionnaire } from "../../src/lib/assessment/types.js";

/**
 * `ui://` is the scheme MCP Apps hosts recognise; the path is stable because
 * a host may cache the resource per uri.
 */
export const PANEL_URI = "ui://ai-act-explorer-nl/assessment/vragenlijst";

/**
 * The MCP Apps profile of text/html (SEP-1865). A host that does not know the
 * profile parameter still sees `text/html`; a host that knows neither falls
 * back to the degradation path described in mcp/README.md.
 */
export const PANEL_MIME = "text/html;profile=mcp-app";

export const PANEL_NAME = "aiact-assessment-panel";

export const PANEL_TITLE = "AI Act-zelfbeoordeling — invulpaneel";

/**
 * The one job this panel has, named here because the viewing need must be
 * readable off the resource itself, not only out of the README.
 */
export const PANEL_DESCRIPTION =
  "Interactive panel for the self-assessment behind get_questionnaire: the 25 modules and 205 " +
  "questions of data/questionnaire/assessment-v1.json as a fillable form, one module at a time, " +
  "with conditional questions appearing and disappearing as answers land and the legal basis " +
  "deep-linked per question. It scores while you fill it in — kwalificatie, rol(len) and " +
  "risicoklasse (incl. art. 5 stops, bijlage III-categorieën and art. 50-transparantie) — " +
  "mirroring the site's assessment engine. The viewing need: a 205-question conditional " +
  "questionnaire is only workable as a form; dictating question ids into chat is the part " +
  "markdown cannot carry. On a deployment with a state file and MCP_TOKEN the panel loads from " +
  "and saves to get_assessment / put_assessment; without them it stays read-only and hands its " +
  "answers to the conversation instead.";

/** HTML-escape for text interpolated into the document shell. */
const esc = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** What this deployment lets the panel do; both flags come from env, per call. */
export interface PanelCaps {
  /** AIACT_ASSESSMENT_STATE is set ⇒ get_assessment exists ⇒ the panel can load. */
  state: boolean;
  /** MCP_TOKEN is set ⇒ put_assessment accepts writes ⇒ the panel can save. */
  write: boolean;
}

const STYLE = `
:root{color-scheme:light dark;--bg:#fff;--fg:#18181b;--muted:#52525b;--line:#e4e4e7;--card:#fafafa;--accent:#1d4ed8;--ok:#15803d;--warn:#b45309;--bad:#b91c1c}
@media (prefers-color-scheme:dark){:root{--bg:#0b0b0d;--fg:#f4f4f5;--muted:#a1a1aa;--line:#27272a;--card:#141417;--accent:#93b4ff;--ok:#4ade80;--warn:#fbbf24;--bad:#f87171}}
*{box-sizing:border-box}
body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:14px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
h1{font-size:17px;margin:0 0 4px}
h2{font-size:15px;margin:0 0 2px}
h3{font-size:13px;margin:0 0 6px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
a{color:var(--accent)}
p{margin:6px 0}
.meta,.help,.note{color:var(--muted);font-size:12.5px}
.disclaimer{border-left:3px solid var(--line);padding:6px 10px;margin:10px 0;font-size:12.5px;color:var(--muted)}
.bar{position:sticky;top:0;z-index:2;background:var(--bg);padding:8px 0;border-bottom:1px solid var(--line);display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.track{flex:1 1 140px;height:6px;background:var(--line);border-radius:3px;overflow:hidden}
.fill{height:100%;background:var(--ok);width:0}
button{font:inherit;padding:6px 11px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--fg);cursor:pointer}
button.primary{background:var(--accent);border-color:var(--accent);color:#fff}
button:disabled{opacity:.55;cursor:default}
button.link{border:0;background:none;color:var(--muted);padding:0 2px;font-size:12px;text-decoration:underline}
.cols{display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap;margin-top:12px}
#rail{flex:0 0 230px;max-width:100%;border:1px solid var(--line);border-radius:8px;padding:8px;background:var(--card);max-height:70vh;overflow:auto}
#rail button{display:block;width:100%;text-align:left;border:0;background:none;padding:5px 7px;border-radius:5px;font-size:12.5px;line-height:1.35}
#rail button:hover{background:var(--line)}
#rail button.on{background:var(--accent);color:#fff}
#rail .cnt{float:right;font-size:11px;opacity:.8}
#main{flex:1 1 380px;min-width:0}
#side{flex:0 0 260px;max-width:100%}
section{border:1px solid var(--line);border-radius:8px;padding:12px;margin:0 0 12px;background:var(--card)}
.badge{display:inline-block;font-size:11px;border:1px solid var(--line);border-radius:99px;padding:1px 8px;margin-left:6px;color:var(--muted);vertical-align:middle}
.risk{display:inline-block;font-size:12px;border:1px solid var(--line);border-radius:99px;padding:2px 10px;font-weight:600}
.risk-verboden{border-color:var(--bad);color:var(--bad)}
.risk-hoogrisico{border-color:var(--warn);color:var(--warn)}
.risk-transparantierisico{border-color:var(--accent);color:var(--accent)}
.risk-minimaal,.risk-geen-ai{border-color:var(--line);color:var(--muted)}
.stop{border:1px solid var(--bad);color:var(--bad);border-radius:6px;padding:6px 9px;font-size:12.5px;margin:8px 0}
.q{border-top:1px solid var(--line);padding-top:10px;margin-top:10px}
.q:first-of-type{border-top:0}
.qid{font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted)}
.opts{display:flex;gap:14px;flex-wrap:wrap;margin:6px 0 2px;align-items:center}
label.opt{display:inline-flex;gap:5px;align-items:center}
input[type=text],select,textarea{font:inherit;width:100%;max-width:520px;padding:5px 7px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg)}
input.short{max-width:230px;width:auto}
textarea{max-width:none;min-height:170px;font:12px ui-monospace,SFMono-Regular,Menlo,monospace}
ul{margin:4px 0;padding-left:18px}
dl{margin:0}
dt{font-size:11px;color:var(--muted);margin-top:7px}
dd{margin:0}
.refs{font-size:12.5px;margin-top:4px}
.status{font-size:12.5px;color:var(--muted);min-height:18px}
.nav{display:flex;gap:8px;justify-content:space-between;margin-top:12px}
.hidden{display:none}
`;

/**
 * The mirrored scorer — see constraint 3 in this file's header. Kept free of
 * template literals, `Set`/`Map` and arrow functions so it survives being
 * embedded in a TS template string and `eval`'d by the parity gate, and so the
 * gate can compare its output to `engine.ts` with a plain deepEqual.
 *
 * Sentinels are load-bearing: scripts/verify-mcp.ts slices between them.
 */
const PANEL_ENGINE = `
/*__PANEL_ENGINE_START__*/
function panelEvaluate(Q, answers){
  /* mirror of ANNEX3_LABELS in src/lib/assessment/engine.ts */
  var ANNEX3_LABELS = {
    "7.1": "1 — Biometrie",
    "7.2": "2 — Kritieke infrastructuur",
    "7.3": "3 — Onderwijs en beroepsopleiding",
    "7.4": "4 — Werkgelegenheid en personeelsbeheer",
    "7.5a": "5(a) — Essentiële publieke diensten",
    "7.5b": "5(b) — Kredietwaardigheid",
    "7.5c": "5(c) — Levens-/ziektekostenverzekering",
    "7.5d": "5(d) — Noodhulp",
    "7.6": "6 — Rechtshandhaving",
    "7.7": "7 — Migratie, asiel en grensbeheer",
    "7.8": "8 — Rechtsbedeling en democratische processen"
  };
  var RISK_LABELS = {
    "geen-ai": "Geen AI-systeem",
    "verboden": "Verboden praktijk (art. 5)",
    "hoogrisico": "Hoog risico",
    "transparantierisico": "Transparantierisico (art. 50)",
    "minimaal": "Minimaal/beperkt risico"
  };

  var flags = {};
  function has(f){ return flags[f] === true; }

  function evalCondition(cond){
    if (cond.all) return cond.all.every(function(c){ return evalCondition(c); });
    if (cond.any) return cond.any.some(function(c){ return evalCondition(c); });
    if (cond.not) return !evalCondition(cond.not);
    if (cond.flag) return has(cond.flag);
    if (cond.answer){
      var v = answers[cond.answer.q];
      var want = cond.answer.is;
      return Object.prototype.toString.call(want) === "[object Array]" ? want.indexOf(v) >= 0 : v === want;
    }
    return true;
  }

  /* the escape of art. 6(3) actually neutralises the Annex III hit */
  function escapeApplies(){
    return has("escape_ingeroepen") && has("escape_conditie") && has("escape_geen_risico") && !has("profilering");
  }

  /* derived flags recomputed between modules so later showIf can use them */
  function deriveFlags(){
    var hoog = has("annex1_hoogrisico") || (has("annex3_kandidaat") && !escapeApplies());
    if (hoog) flags.hoogrisico = true; else delete flags.hoogrisico;
  }

  var visibleModules = {};
  var visibleQuestions = {};
  var mi, qi, ei;
  for (mi = 0; mi < Q.modules.length; mi++){
    var mod = Q.modules[mi];
    deriveFlags();
    var moduleVisible = !mod.showIf || evalCondition(mod.showIf);
    if (moduleVisible) visibleModules[mod.id] = true;
    for (qi = 0; qi < mod.questions.length; qi++){
      var q = mod.questions[qi];
      deriveFlags();
      var visible = moduleVisible && (!q.showIf || evalCondition(q.showIf));
      if (!visible) continue;
      visibleQuestions[q.id] = true;
      var answer = answers[q.id];
      if (answer === undefined || answer === "") continue;
      var effects = q.effects || [];
      for (ei = 0; ei < effects.length; ei++){
        var eff = effects[ei];
        var match = Object.prototype.toString.call(eff.when) === "[object Array]"
          ? eff.when.indexOf(answer) >= 0
          : eff.when === answer;
        if (match) flags[eff.setFlag] = true;
      }
    }
  }
  deriveFlags();

  var stops = [];
  var openActions = [];
  var total = 0;
  for (mi = 0; mi < Q.modules.length; mi++){
    for (qi = 0; qi < Q.modules[mi].questions.length; qi++){
      var qq = Q.modules[mi].questions[qi];
      if (!visibleQuestions[qq.id]) continue;
      total++;
      if (qq.prohibition && answers[qq.id] === "ja") stops.push(qq.id);
      if (qq.obligation && answers[qq.id] === "nee"){
        openActions.push({ questionId: qq.id, moduleId: Q.modules[mi].id, text: qq.text });
      }
    }
  }

  var geenAi = has("geen_ai") && !has("ai_systeem");
  var kwalificatie = geenAi
    ? "Geen AI-systeem"
    : has("gpai_model")
      ? "GPAI-model"
      : has("gpai_systeem")
        ? "GPAI-systeem"
        : has("ai_systeem")
          ? "AI-systeem"
          : "";

  var rollen = [];
  if (has("rol_aanbieder")) rollen.push("Aanbieder");
  if (has("rol_deployer")) rollen.push("Gebruiksverantwoordelijke (deployer)");
  if (has("rol_importeur")) rollen.push("Importeur");
  if (has("rol_distributeur")) rollen.push("Distributeur");
  if (has("rol_gemachtigde")) rollen.push("Gemachtigde");

  var transparantieLeden = [];
  if (has("transparantie_lid1")) transparantieLeden.push("lid 1");
  if (has("transparantie_lid2")) transparantieLeden.push("lid 2");
  if (has("transparantie_lid3")) transparantieLeden.push("lid 3");
  if (has("transparantie_lid4")) transparantieLeden.push("lid 4");

  var riskClass = geenAi
    ? "geen-ai"
    : stops.length > 0
      ? "verboden"
      : has("hoogrisico")
        ? "hoogrisico"
        : transparantieLeden.length > 0
          ? "transparantierisico"
          : "minimaal";

  var annex3Categorieen = [];
  var a3 = Object.keys(ANNEX3_LABELS);
  for (var ai = 0; ai < a3.length; ai++){
    if (visibleQuestions[a3[ai]] && answers[a3[ai]] === "ja") annex3Categorieen.push(ANNEX3_LABELS[a3[ai]]);
  }

  var answered = 0;
  var keys = Object.keys(answers);
  for (var ki = 0; ki < keys.length; ki++){
    if (answers[keys[ki]] !== "" && visibleQuestions[keys[ki]]) answered++;
  }

  return {
    flags: flags,
    visibleModules: visibleModules,
    visibleQuestions: visibleQuestions,
    kwalificatie: kwalificatie,
    rollen: rollen,
    riskClass: riskClass,
    riskLabel: RISK_LABELS[riskClass],
    stops: stops,
    annex3Categorieen: annex3Categorieen,
    annex1: has("annex1_hoogrisico"),
    escape: {
      ingeroepen: has("escape_ingeroepen"),
      mogelijk: has("escape_conditie") && has("escape_geen_risico") && !has("profilering"),
      geblokkeerdDoorProfilering: has("annex3_kandidaat") && has("profilering")
    },
    friaVereist: has("fria_vereist"),
    transparantieLeden: transparantieLeden,
    openActions: openActions,
    answered: answered,
    total: total
  };
}
/*__PANEL_ENGINE_END__*/
`;

/**
 * The client half. Deliberately dependency-free and written without template
 * literals so it survives being embedded in a TS template string, and built
 * with createElement/textContent rather than innerHTML.
 *
 * The host bridge is hand-rolled (postMessage + JSON-RPC) rather than pulled
 * from @modelcontextprotocol/ext-apps: that package is ESM-only and this build
 * is CommonJS, and the bridge is ~20 lines. Every host call is wrapped — a
 * client that does not answer falls through to the copy-paste path, which is
 * the same path a client that cannot render HTML at all gets.
 */
const SCRIPT = `
(function(){
  var Q = JSON.parse(document.getElementById("aiact-questionnaire").textContent);
  var BODY = document.body;
  var BASE = BODY.getAttribute("data-base");
  var CAN_LOAD = BODY.getAttribute("data-state") === "on";
  var CAN_SAVE = BODY.getAttribute("data-write") === "on";

  var answers = {};
  var current = Q.modules[0].id;
  var ev = panelEvaluate(Q, answers);
  var idTouched = false;

  function el(tag, attrs, kids){
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function(k){
      if (k === "text") n.textContent = attrs[k];
      else if (k === "cls") n.className = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function(k){ if (k) n.appendChild(k); });
    return n;
  }
  function txt(s){ return document.createTextNode(s); }
  function clear(node){ while (node.firstChild) node.removeChild(node.firstChild); }

  function moduleById(id){
    for (var i = 0; i < Q.modules.length; i++) if (Q.modules[i].id === id) return Q.modules[i];
    return Q.modules[0];
  }
  function visibleModules(){
    return Q.modules.filter(function(m){ return ev.visibleModules[m.id]; });
  }
  function visibleQuestions(m){
    return m.questions.filter(function(q){ return ev.visibleQuestions[q.id]; });
  }

  /* mirror of answerLabel() in src/lib/assessment/engine.ts */
  function answerLabel(q, v){
    if (v === undefined || v === "") return "";
    if (q.answerType === "choice"){
      var hit = (q.options || []).filter(function(o){ return o.value === v; })[0];
      return hit ? hit.label : v;
    }
    if (v === "ja") return "Ja";
    if (v === "nee") return "Nee";
    if (v === "nvt") return "N.v.t.";
    return v;
  }
  function optionsFor(q){
    if (q.answerType === "janee") return [{ value: "ja", label: "Ja" }, { value: "nee", label: "Nee" }];
    if (q.answerType === "janeenvt") return [{ value: "ja", label: "Ja" }, { value: "nee", label: "Nee" }, { value: "nvt", label: "N.v.t." }];
    return q.options || [];
  }

  function link(ref){
    return el("a", { href: BASE + ref.href, target: "_blank", rel: "noreferrer", text: ref.label });
  }
  function refsLine(refs){
    if (!refs || !refs.length) return null;
    var p = el("div", { cls: "refs" }, [txt("Grondslag: ")]);
    refs.forEach(function(r, i){
      if (i) p.appendChild(txt(" · "));
      p.appendChild(link(r));
    });
    return p;
  }
  /* help/intro are string | (string | {bullets:[]})[] — both shapes render.
     Mirror of helpLines() in mcp/src/server.ts. */
  function helpNodes(help){
    if (!help) return [];
    var blocks = typeof help === "string" ? [help] : help;
    return blocks.map(function(b){
      if (typeof b === "string") return el("p", { cls: "help", text: b });
      var ul = el("ul", { cls: "help" });
      (b.bullets || []).forEach(function(t){ ul.appendChild(el("li", { text: t })); });
      return ul;
    });
  }

  function set(id, value){
    if (value === "" || value === undefined || value === null) delete answers[id];
    else answers[id] = value;
  }

  function slug(s){
    var out = (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+/, "").replace(/-+$/, "");
    return out ? out.slice(0, 48) : "toepassing";
  }
  function sysField(){ return document.getElementById("sysid"); }
  function sysId(){
    var f = sysField();
    var v = f ? f.value.trim() : "";
    return v || slug(answers["1.1"]);
  }
  function sysName(){ return (answers["1.1"] || "").trim() || sysId(); }
  function blob(){
    var now = Date.now();
    return { v: 1, systems: [{ id: sysId(), name: sysName(), answers: answers, createdAt: now, updatedAt: now }] };
  }

  /* ---------------------------------------------------------------- render */

  function renderBar(){
    document.getElementById("count").textContent =
      ev.answered + " van " + ev.total + " zichtbare vragen beantwoord";
    document.getElementById("fill").style.width =
      (ev.total ? Math.round((ev.answered / ev.total) * 100) : 0) + "%";
    ["send", "copy"].forEach(function(id){
      var b = document.getElementById(id);
      if (b) b.disabled = ev.answered === 0;
    });
    var save = document.getElementById("save");
    if (save) save.disabled = ev.answered === 0;
    if (!idTouched && sysField()) sysField().value = slug(answers["1.1"]);
  }

  function renderRail(){
    var rail = document.getElementById("rail");
    clear(rail);
    rail.appendChild(el("h3", { text: "Modules" }));
    visibleModules().forEach(function(m){
      var qs = visibleQuestions(m);
      var done = qs.filter(function(q){ return answers[q.id]; }).length;
      var b = el("button", {
        cls: m.id === current ? "on" : "",
        type: "button",
        text: m.nr + ". " + m.title
      });
      b.appendChild(el("span", { cls: "cnt", text: done + "/" + qs.length }));
      b.addEventListener("click", function(){ current = m.id; update(true); });
      rail.appendChild(b);
    });
  }

  function questionBox(q){
    var box = el("div", { cls: "q", id: "vraag-" + q.id }, [
      el("div", { cls: "qid", text: q.id }),
      el("p", { text: q.text })
    ]);
    if (q.omnibus){
      box.appendChild(el("p", {
        cls: "note",
        text: "Omnibus" + (q.omnibus.appliesFrom ? " (vanaf " + q.omnibus.appliesFrom + ")" : "") + ": " + q.omnibus.note
      }));
    }
    helpNodes(q.help).forEach(function(n){ box.appendChild(n); });

    if (q.answerType === "text"){
      var t = el("input", { type: "text", id: "in-" + q.id, placeholder: "Antwoord" });
      t.value = answers[q.id] || "";
      /* typing only refreshes the derived panes: rebuilding the form on every
         keystroke would steal focus. The blur/change pass rebuilds. */
      t.addEventListener("input", function(){ set(q.id, t.value.trim()); update(false); });
      t.addEventListener("change", function(){ set(q.id, t.value.trim()); update(true); });
      box.appendChild(t);
    } else {
      var wrap = el("div", { cls: "opts" });
      optionsFor(q).forEach(function(o){
        var rid = "in-" + q.id + "-" + o.value;
        var r = el("input", { type: "radio", name: "q-" + q.id, id: rid, value: o.value });
        if (answers[q.id] === o.value) r.setAttribute("checked", "checked");
        r.addEventListener("change", function(){ set(q.id, o.value); update(true); });
        wrap.appendChild(el("label", { cls: "opt", "for": rid }, [r, txt(o.label)]));
      });
      if (answers[q.id]){
        var wis = el("button", { cls: "link", type: "button", text: "wissen" });
        wis.addEventListener("click", function(){ set(q.id, ""); update(true); });
        wrap.appendChild(wis);
      }
      box.appendChild(wrap);
    }

    var refs = refsLine(q.refs);
    if (refs) box.appendChild(refs);
    var marks = [];
    if (q.obligation) marks.push("verplichting");
    if (q.prohibition) marks.push("verbod art. 5 — een 'ja' is een STOP");
    if (marks.length) box.appendChild(el("p", { cls: "note", text: marks.join(" · ") }));
    return box;
  }

  function renderModule(){
    var host = document.getElementById("main");
    clear(host);
    var mods = visibleModules();
    var m = moduleById(current);
    var pos = mods.map(function(x){ return x.id; }).indexOf(m.id);

    var head = el("h2", { text: "Module " + m.nr + " — " + m.title });
    if (m.showIf) head.appendChild(el("span", { cls: "badge", text: "voorwaardelijk" }));
    if (m.financeOnly) head.appendChild(el("span", { cls: "badge", text: "financiële entiteiten" }));
    var sec = el("section", { id: "mod-" + m.id }, [head, refsLine(m.refs)]);
    if (m.omnibus){
      sec.appendChild(el("p", {
        cls: "note",
        text: "Omnibus" + (m.omnibus.appliesFrom ? " (vanaf " + m.omnibus.appliesFrom + ")" : "") + ": " + m.omnibus.note
      }));
    }
    helpNodes(m.intro).forEach(function(n){ sec.appendChild(n); });

    var qs = visibleQuestions(m);
    if (!qs.length){
      sec.appendChild(el("p", { cls: "note", text: "Geen vragen van deze module zijn op dit moment van toepassing." }));
    }
    qs.forEach(function(q){ sec.appendChild(questionBox(q)); });

    var nav = el("div", { cls: "nav" });
    var prev = el("button", { type: "button", text: "← Vorige module" });
    prev.disabled = pos <= 0;
    prev.addEventListener("click", function(){ current = mods[pos - 1].id; update(true); window.scrollTo(0, 0); });
    var next = el("button", { type: "button", cls: "primary", text: "Volgende module →" });
    next.disabled = pos < 0 || pos >= mods.length - 1;
    next.addEventListener("click", function(){ current = mods[pos + 1].id; update(true); window.scrollTo(0, 0); });
    nav.appendChild(prev);
    nav.appendChild(el("span", { cls: "meta", text: "Module " + (pos + 1) + " van " + mods.length + " zichtbare modules" }));
    nav.appendChild(next);
    sec.appendChild(nav);
    host.appendChild(sec);
  }

  function row(dl, label, value){
    dl.appendChild(el("dt", { text: label }));
    dl.appendChild(el("dd", { text: value }));
  }

  /* The outcome pane. Mirrors src/components/assessment/Outcome.tsx as far as
     the panel goes: risk badge, art. 5 stops, kwalificatie/rol/bijlage III/
     transparantie/open acties. The obligation checklist, the register row and
     the timeline stay on the site — this pane says where. */
  function renderOutcome(){
    var side = document.getElementById("side");
    clear(side);
    var sec = el("section", {}, [el("h3", { text: "Uitkomst" })]);
    sec.appendChild(el("span", { cls: "risk risk-" + ev.riskClass, text: ev.riskLabel }));
    if (ev.answered < ev.total){
      sec.appendChild(el("p", { cls: "note", text: "Voorlopig: " + ev.answered + " van " + ev.total + " zichtbare vragen beantwoord." }));
    }
    if (ev.stops.length){
      sec.appendChild(el("p", {
        cls: "stop",
        text: "Verboden praktijk gesignaleerd (vraag " + ev.stops.join(", ") + "): niet inzetten, bestaand gebruik staken en escaleren naar Legal & Compliance."
      }));
    }
    var dl = el("dl");
    row(dl, "Kwalificatie", ev.kwalificatie || "Nog niet bepaald");
    row(dl, "Rol(len)", ev.rollen.join(", ") || "Nog niet bepaald");
    row(dl, "Bijlage III-categorie(ën)", ev.annex3Categorieen.join("; ") || "Geen");
    row(dl, "Bijlage I (productveiligheid)", ev.annex1 ? "Ja" : "Nee");
    row(dl, "Uitzondering art. 6, lid 3", ev.escape.geblokkeerdDoorProfilering
      ? "Uitgesloten (profilering)"
      : ev.escape.ingeroepen ? "Ingeroepen" : "Niet ingeroepen");
    row(dl, "FRIA (art. 27)", ev.friaVereist ? "Vereist" : "Niet vereist");
    row(dl, "Transparantie art. 50", ev.transparantieLeden.join(", ") || "N.v.t.");
    row(dl, "Openstaande acties", ev.openActions.length
      ? ev.openActions.length + " (" + ev.openActions.map(function(o){ return o.questionId; }).join(", ") + ")"
      : "Geen");
    sec.appendChild(dl);
    var p = el("p", { cls: "note" }, [
      txt("Verplichtingen-checklist, registerrij en tijdlijn: "),
      el("a", { href: BASE + "/assessment", target: "_blank", rel: "noreferrer", text: BASE + "/assessment" }),
      txt(".")
    ]);
    sec.appendChild(p);
    side.appendChild(sec);
  }

  function update(rebuild){
    ev = panelEvaluate(Q, answers);
    if (!ev.visibleModules[current]){
      var vis = visibleModules();
      current = vis.length ? vis[0].id : Q.modules[0].id;
      rebuild = true;
    }
    renderBar();
    renderRail();
    renderOutcome();
    if (rebuild) renderModule();
  }

  /* --------------------------------------------------------------- summary */

  function summary(){
    var lines = [
      "# " + Q.meta.title + " — versie " + Q.meta.version,
      "",
      "Ingevuld in het MCP-paneel (" + ev.answered + " van " + ev.total + " zichtbare vragen beantwoord).",
      "",
      "## Uitkomst",
      "",
      "- **Risicoklasse:** " + ev.riskLabel,
      "- **Kwalificatie:** " + (ev.kwalificatie || "nog niet bepaald"),
      "- **Rol(len):** " + (ev.rollen.join(", ") || "nog niet bepaald"),
      "- **Verboden praktijk (art. 5):** " + (ev.stops.length ? "ja — vraag " + ev.stops.join(", ") : "nee"),
      "- **Bijlage III:** " + (ev.annex3Categorieen.join("; ") || "geen"),
      "- **Bijlage I:** " + (ev.annex1 ? "ja" : "nee"),
      "- **Transparantie art. 50:** " + (ev.transparantieLeden.join(", ") || "n.v.t."),
      "- **Openstaande acties:** " + (ev.openActions.length
        ? ev.openActions.length + " (" + ev.openActions.map(function(o){ return o.questionId; }).join(", ") + ")"
        : "geen"),
      ""
    ];
    Q.modules.forEach(function(m){
      var rows = m.questions.filter(function(q){ return ev.visibleQuestions[q.id] && answers[q.id]; });
      if (!rows.length) return;
      lines.push("## Module " + m.nr + " (" + m.id + ") — " + m.title);
      rows.forEach(function(q){
        lines.push("- " + q.id + " — " + q.text + " → **" + answerLabel(q, answers[q.id]) + "**");
      });
      lines.push("");
    });
    lines.push(
      "Antwoordblob (vorm \`aiact-assessments\`, geschikt voor put_assessment):",
      "",
      "\`\`\`json",
      JSON.stringify(blob(), null, 1),
      "\`\`\`",
      ""
    );
    lines.push(
      "Antwoorden, geen conclusies: de blob bewaart alleen antwoorden. De uitkomst hierboven is " +
      "berekend in het paneel met dezelfde regels als " + BASE + "/assessment; de verplichtingen-" +
      "checklist, de registerrij en de tijdlijn staan daar (en per rol in het tool get_obligations)."
    );
    return lines.join("\\n");
  }

  /* ---------------------------------------------------------------- bridge */

  var host = (function(){
    var pending = {}, seq = 0;
    var framed = window.parent && window.parent !== window;
    window.addEventListener("message", function(evt){
      var m = evt.data;
      if (!m || m.jsonrpc !== "2.0" || m.id == null || !pending[m.id]) return;
      var done = pending[m.id];
      delete pending[m.id];
      done(m);
    });
    return {
      framed: framed,
      call: function(method, params){
        return new Promise(function(resolve, reject){
          if (!framed) return reject(new Error("geen host"));
          var id = "aiact-" + (++seq);
          var timer = setTimeout(function(){ delete pending[id]; reject(new Error("host antwoordt niet")); }, 8000);
          pending[id] = function(m){
            clearTimeout(timer);
            if (m.error) reject(new Error(m.error.message || "hostfout"));
            else resolve(m.result);
          };
          window.parent.postMessage({ jsonrpc: "2.0", id: id, method: method, params: params }, "*");
        });
      }
    };
  })();

  function status(msg){ document.getElementById("status").textContent = msg; }

  function fallback(text, why){
    var box = document.getElementById("fallback");
    box.classList.remove("hidden");
    document.getElementById("blob").value = text;
    status(why + " Kopieer de tekst hieronder in het gesprek.");
  }

  /* A tools/call result is in-band: put_assessment refuses with isError, not
     with a JSON-RPC error, so the result has to be inspected. */
  function resultText(res){
    var c = (res && res.content) || [];
    return c.map(function(b){ return b.text || ""; }).join("\\n");
  }

  document.getElementById("send").addEventListener("click", function(){
    var md = summary();
    if (!host.framed) return fallback(md, "Deze client rendert het paneel zonder MCP-Apps-host.");
    status("Versturen…");
    host.call("ui/update-model-context", { content: [{ type: "text", text: md }] })
      .then(function(){
        return host.call("ui/message", { content: [{ type: "text", text: "Ik heb de AI Act-zelfbeoordeling ingevuld: " + ev.answered + " van " + ev.total + " zichtbare vragen. Uitkomst: " + ev.riskLabel + (ev.rollen.length ? " · " + ev.rollen.join(", ") : "") + "." }] });
      })
      .then(function(){ status("Antwoorden en uitkomst naar het gesprek gestuurd."); })
      .catch(function(e){ fallback(md, "De host nam de antwoorden niet aan (" + e.message + ")."); });
  });

  document.getElementById("copy").addEventListener("click", function(){
    fallback(summary(), "Antwoorden en uitkomst als markdown.");
  });

  var loadBtn = document.getElementById("load");
  if (loadBtn) loadBtn.addEventListener("click", function(){
    if (!host.framed) return status("Zonder host: gebruik get_assessment in het gesprek en plak de antwoorden hier.");
    status("Opgeslagen antwoorden ophalen…");
    host.call("tools/call", { name: "get_assessment", arguments: { system: sysId() } })
      .then(function(res){
        var md = resultText(res);
        if (res && res.isError) throw new Error(md.slice(0, 200));
        var m = md.match(/\`\`\`json\\n([\\s\\S]+?)\\n\`\`\`/);
        if (!m) throw new Error("geen blob in het antwoord");
        var state = JSON.parse(m[1]);
        var sys = (state.systems || [])[0];
        if (!sys) throw new Error("geen toepassing met id " + sysId());
        answers = {};
        Object.keys(sys.answers || {}).forEach(function(k){ if (sys.answers[k] !== "") answers[k] = sys.answers[k]; });
        idTouched = true;
        if (sysField()) sysField().value = sys.id;
        update(true);
        status("Antwoorden geladen uit " + sys.id + " (" + Object.keys(answers).length + " antwoorden).");
      })
      .catch(function(e){ status("Laden mislukt (" + e.message + "). Vul het paneel handmatig in."); });
  });

  var saveBtn = document.getElementById("save");
  if (saveBtn) saveBtn.addEventListener("click", function(){
    var payload = blob();
    if (!host.framed) return fallback(JSON.stringify(payload, null, 2), "Deze client kan put_assessment niet aanroepen.");
    status("Opslaan…");
    host.call("tools/call", { name: "put_assessment", arguments: { blob: payload } })
      .then(function(res){
        var md = resultText(res);
        if (res && res.isError) throw new Error(md.slice(0, 300));
        status("Opgeslagen als " + payload.systems[0].id + ".");
      })
      .catch(function(e){
        fallback(JSON.stringify(payload, null, 2), "Opslaan mislukt (" + e.message + ").");
      });
  });

  var idField = sysField();
  if (idField) idField.addEventListener("input", function(){ idTouched = true; });

  update(true);
  if (!host.framed) status("Geen MCP-Apps-host gedetecteerd — versturen valt terug op kopiëren.");
})();
`;

/**
 * The panel document. `questionnaire` is embedded verbatim (only `<` escaped,
 * which is all a JSON payload needs inside a script element) so the rendered
 * form and `assessment-v1.json` cannot disagree.
 */
export function renderPanel(
  questionnaire: Questionnaire,
  baseUrl: string,
  caps: PanelCaps,
): string {
  const { meta } = questionnaire;
  const totalQuestions = questionnaire.modules.reduce((n, m) => n + m.questions.length, 0);
  const island = JSON.stringify(questionnaire).replace(/</g, "\\u003c");
  // The write controls are the only capability-dependent part of the document:
  // a deployment without a state file renders the identical form, minus these.
  const loadButton = caps.state
    ? '\n  <button id="load">Opgeslagen antwoorden laden</button>'
    : "";
  const saveButton = caps.write
    ? '\n  <button id="save" disabled>Opslaan op de server</button>'
    : "";
  const idField = caps.state || caps.write
    ? '\n  <label class="meta" for="sysid">Toepassing-id <input class="short" type="text" id="sysid" placeholder="toepassing"></label>'
    : "";
  const capsNote = caps.write
    ? "Deze server bewaart antwoorden: laden en opslaan lopen via get_assessment / put_assessment."
    : caps.state
      ? "Deze server kan opgeslagen antwoorden laden (get_assessment), maar opslaan is niet geauthenticeerd (MCP_TOKEN ontbreekt) — gebruik daarvoor het gesprek."
      : "Deze server bewaart niets: de antwoorden blijven in dit paneel en gaan naar het gesprek.";

  return `<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(meta.title)}</title>
<style>${STYLE}</style>
</head>
<body data-base="${esc(baseUrl)}" data-state="${caps.state ? "on" : "off"}" data-write="${caps.write ? "on" : "off"}">
<h1>${esc(meta.title)}</h1>
<p class="meta">Versie ${meta.version} · bijgewerkt ${esc(meta.updated)} · ${questionnaire.modules.length} modules, ${totalQuestions} vragen<br>Grondslag: ${esc(meta.basis)}</p>
<p class="disclaimer">${esc(meta.disclaimer)}</p>
<div class="bar">
  <span id="count" class="meta">0 van ${totalQuestions} vragen beantwoord</span>
  <span class="track"><span class="fill" id="fill"></span></span>
  <button id="send" class="primary" disabled>Naar het gesprek</button>
  <button id="copy" disabled>Kopieer als markdown</button>${loadButton}${saveButton}${idField}
</div>
<p id="status" class="status"></p>
<p class="note">Alleen de modules en vragen die op uw antwoorden van toepassing zijn worden getoond; de uitkomst rechts wordt bij elk antwoord opnieuw berekend met dezelfde regels als de wizard op <a href="${esc(baseUrl)}/assessment" target="_blank" rel="noreferrer">${esc(baseUrl)}/assessment</a>. ${capsNote}</p>
<div class="cols">
  <nav id="rail"></nav>
  <div id="main"></div>
  <aside id="side"></aside>
</div>
<div id="fallback" class="hidden">
  <p class="note">Antwoorden — selecteer en kopieer:</p>
  <textarea id="blob" readonly></textarea>
</div>
<script type="application/json" id="aiact-questionnaire">${island}</script>
<script>${PANEL_ENGINE}</script>
<script>${SCRIPT}</script>
</body>
</html>`;
}
