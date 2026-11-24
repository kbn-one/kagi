/**
 * KagiApp — the approver's screen on `/kagi`, the home-screen app's start page.
 *
 * Until the phone is set up it walks through three steps, one screen each (`lib/kagi/setup.ts`):
 * add to the home screen, turn notifications on (which also registers this phone as the approver,
 * `lib/kagi/device.ts`), and create the passkey that seals the secrets (`lib/kagi/vault.ts`).
 *
 * Then it is the approver's screen: three tabs in `@remix-kbn/apple-ui`'s `TabView`, each a `#hash`
 * on `/kagi` — 承認 (`#approve`, the default, where a notification lands: the requests waiting for a
 * decision, live over the subscription's WebSocket, `lib/kagi/connection.ts`), 金庫 (`#vault`, the
 * secrets) and 設定 (`#settings`: notifications, what a requester needs to know, the passkey, and
 * this phone's registration).
 *
 * Approving asks for the passkey every time: that unlocks the secrets, fills the request's
 * placeholders, makes the call from this browser, and keeps the (scrubbed) answer in memory until
 * the requester's `GET /res` comes for it.
 */

import {
  clientEntry,
  css,
  type Handle,
  on,
  ref,
  type SerializableValue,
} from "@remix-run/component";

import { TabView } from "@remix-kbn/apple-ui/tabview";

import { routes } from "../routes.ts";
import {
  actionStyle,
  alertStyle,
  cardStyle,
  dangerStyle,
  primaryStyle,
} from "../theme.ts";
import { color, contentWidth, font, radius } from "../tokens.ts";
import { showA2hsGuide } from "@kuboon/browser-how-to/a2hs/ui";
import { showPasskeyGuide } from "@kuboon/browser-how-to/passkeys/ui";
import { createPushGuide, showPushGuide } from "@kuboon/browser-how-to/push/ui";
import {
  browserModeChosen,
  canUseBrowser,
  chooseBrowserMode,
  device,
  forgetSetup,
  installer,
  markPushDone,
  pushDone,
  pushStatus,
} from "../lib/kagi/setup.ts";
import { agentBrief } from "../lib/kagi/brief.ts";
import {
  clearHistory,
  formatTime,
  isPast,
  mergeHistory,
  readDeleted,
  readHistory,
  removeFromHistory,
  selectRange,
  shownStatus,
  writeDeleted,
  writeHistory,
} from "../lib/kagi/history.ts";
import { connect, type KagiConnection } from "../lib/kagi/connection.ts";
import { sealedCall } from "../lib/kagi/relay_seal.ts";
import {
  createSubscription,
  forgetSubscription,
  openRelay,
  readSubscription,
  type Subscription,
} from "../lib/kagi/device.ts";
import {
  appJwt,
  callGithubApi,
  createRepository,
  mintInstallationToken,
} from "../lib/kagi/github_app.ts";
import {
  type GithubApiRequest,
  type GithubAppTokenRequest,
  type GithubCreateRepoRequest,
  type HttpRequest,
  isAppTokenRequest,
  isCreateRepoRequest,
  isGithubApiRequest,
  isHttpRequest,
  isSecretName,
  type KagiRequest,
  methodOf,
  type Transaction,
  type TxStatus,
} from "../lib/kagi/protocol.ts";
import {
  execute,
  executeRelayed,
  type GithubAppSecret,
  hostOf,
  isAppSecret,
  secretsProblem,
  type SecretSummary,
  textSecretFrom,
  usesRelay,
} from "../lib/kagi/substitute.ts";
import {
  createVault,
  deleteVault,
  forgetSecret,
  hasVault,
  passkeysAvailable,
  type UnlockedVault,
  unlockVault,
  vaultNames,
} from "../lib/kagi/vault.ts";

type AlertKind = "info" | "success" | "warning" | "error";

export interface KagiAppProps {
  [key: string]: SerializableValue;
}

const isClientEnv = typeof document !== "undefined";

const STATUS_LABEL: Record<TxStatus, string> = {
  pending: "承認待ち",
  approved: "実行中",
  done: "完了 (受け取り待ち)",
  delivered: "受け渡し済み",
  rejected: "拒否",
  failed: "失敗",
  expired: "期限切れ",
};

/** The approver's three tabs, each a `#hash` on `/kagi`. */
type Tab = "approve" | "vault" | "settings";

const TAB_TITLE: Record<Tab, string> = {
  approve: "承認",
  vault: "金庫",
  settings: "設定",
};

/** The tab a URL's hash names; anything else is 承認, where a notification lands. */
const tabOf = (hash: string): Tab => {
  const name = hash.replace(/^#/, "");
  return name === "vault" || name === "settings" ? name : "approve";
};

const errorText = (e: unknown, fallback: string) =>
  e instanceof Error && e.message ? e.message : fallback;

export const KagiApp = clientEntry(
  import.meta.url,
  function KagiApp(handle: Handle<KagiAppProps>) {
    let status: { message: string; kind: AlertKind } | null = null;
    let busy = false;

    /**
     * Whether the browser-only state below has been read. Until then the island renders what the
     * server rendered: anything read from localStorage or the browser's APIs during the first render
     * would not match the server's HTML, and hydration would duplicate the mismatched part.
     */
    let loaded = false;
    let passkeys = false;
    let vaultExists = false;
    /** Held only while the secrets card is open for editing. */
    let unlocked: UnlockedVault | null = null;
    /** The secrets' names, in the clear beside the vault: shown even while it is closed. */
    let names: Record<string, SecretSummary> = {};

    let sub: Subscription | null = null;
    /** Launched from the home screen. */
    let standalone = false;
    /** The approver chose to carry on in the browser (`setup.ts`). */
    let browserMode = false;
    /** Notifications have worked once on this phone. */
    let pushOk = false;
    let connection: KagiConnection | null = null;
    /** Every request this phone has seen, newest first (`lib/kagi/history.ts`). */
    let history: Transaction[] = [];
    /** Deleted entries the server may still send (`lib/kagi/history.ts`). */
    let deleted = new Map<string, number>();
    /** Choosing history entries to delete. */
    let deleting = false;
    let selected = new Set<string>();
    /** The past entries' ids in the order last rendered: what a swipe's row numbers mean. */
    let pastIds: string[] = [];
    /**
     * A finger on a history row in delete mode. It becomes a range selection once it moves
     * sideways (`active`); moving up or down first is a scroll, which the browser takes over.
     */
    let swipe: {
      pointerId: number;
      x: number;
      y: number;
      anchor: number;
      select: boolean;
      base: Set<string>;
      active: boolean;
    } | null = null;
    /** The tab on show, from the URL's hash (read after hydration, like the rest). */
    let tab: Tab = "approve";
    const focusTx = isClientEnv
      ? new URL(location.href).searchParams.get("tx")
      : null;

    let nameInput: HTMLInputElement | null = null;
    let valueInput: HTMLInputElement | null = null;
    let hostsInput: HTMLInputElement | null = null;
    let relayInput: HTMLInputElement | null = null;
    /**
     * The secret being edited, when the open vault's form holds one: its name is fixed, and an
     * empty value (or App key) keeps the one saved.
     */
    let editing: { name: string; kind: "text" | "github-app" } | null = null;
    let secretCard: HTMLElement | null = null;
    let appCard: HTMLElement | null = null;
    let appNameInput: HTMLInputElement | null = null;
    let appIdInput: HTMLInputElement | null = null;
    let appKeyInput: HTMLTextAreaElement | null = null;

    const setStatus = (message: string, kind: AlertKind = "info") => {
      status = { message, kind };
      handle.update();
    };

    const run = async (task: () => Promise<void>) => {
      if (busy) return;
      busy = true;
      status = null;
      handle.update();
      try {
        await task();
      } catch (e) {
        setStatus(errorText(e, "失敗しました。"), "error");
      } finally {
        busy = false;
        handle.update();
      }
    };

    const startConnection = () => {
      connection?.close();
      connection = sub
        ? connect(sub.id, () => {
          if (!pushOk && connection?.push === "on") {
            markPushDone();
            pushOk = true;
          }
          if (connection?.transactions.size) {
            history = mergeHistory(
              history,
              connection.transactions.values(),
              deleted,
            );
            writeHistory(history);
          }
          handle.update();
        })
        : null;
    };

    if (isClientEnv) {
      // After hydration, not during it — see `loaded`.
      setTimeout(() => {
        if (handle.signal.aborted) return;
        passkeys = passkeysAvailable();
        vaultExists = hasVault();
        names = vaultNames();
        sub = readSubscription();
        standalone = device().isStandalone;
        browserMode = browserModeChosen();
        pushOk = pushDone();
        tab = tabOf(location.hash);
        history = readHistory();
        deleted = readDeleted();
        writeDeleted(deleted);
        loaded = true;
        startConnection();
        handle.update();
      }, 0);
      handle.signal.addEventListener("abort", () => connection?.close());
      // The tab bar's tabs are `#hash` links; a message from one tab means nothing on the next.
      addEventListener("hashchange", () => {
        const next = tabOf(location.hash);
        if (next === tab) return;
        tab = next;
        status = null;
        handle.update();
      }, { signal: handle.signal });
    }

    /** Shows `next`, keeping the status line (unlike a tap on the tab bar). */
    const goTo = (next: Tab) => {
      tab = next;
      location.hash = next;
    };

    // --- secrets --------------------------------------------------------------

    const onCreateVault = () =>
      run(async () => {
        if (
          vaultExists &&
          !confirm("今の秘密を消して、新しいパスキーで作り直しますか？")
        ) return;
        unlocked = await createVault();
        vaultExists = true;
        names = vaultNames();
        goTo("vault");
        setStatus(
          "パスキーを作成しました。最初の秘密を追加してください。",
          "success",
        );
      });

    const onUnlock = () =>
      run(async () => {
        unlocked = await unlockVault();
        names = vaultNames();
      });

    const onLock = () => {
      onCancelEdit();
      unlocked = null;
      handle.update();
    };

    const onAddSecret = () =>
      run(async () => {
        if (!unlocked) return;
        const editingText = editing?.kind === "text" ? editing.name : null;
        const name = editingText ?? nameInput?.value.trim() ?? "";
        const hosts = (hostsInput?.value ?? "").split(/[\s,]+/).filter(Boolean);
        if (!isSecretName(name)) {
          throw new Error(
            "名前は英字・数字・_ で、英字か _ で始めてください。",
          );
        }
        if (!editingText && unlocked.entries[name]) {
          throw new Error(
            `${name} はもうあります。変えるときは一覧の「編集」から。`,
          );
        }
        const entry = textSecretFrom(
          {
            value: valueInput?.value ?? "",
            hosts,
            relay: relayInput?.checked ?? false,
          },
          editingText ? unlocked.entries[editingText] : undefined,
        );
        const entries = { ...unlocked.entries, [name]: entry };
        await unlocked.save(entries);
        unlocked.entries = entries;
        names = vaultNames();
        clearSecretForm();
        setStatus(`${name} を保存しました。`, "success");
      });

    /** Reads a picked .pem into the key field; nothing leaves the phone until it is sealed. */
    const onPickKeyFile = async (input: HTMLInputElement) => {
      const file = input.files?.[0];
      input.value = "";
      if (!file) return;
      try {
        if (file.size > 16 * 1024) {
          throw new Error("秘密鍵のファイルにしては大きすぎます。");
        }
        const text = (await file.text()).trim();
        if (!/-----BEGIN (RSA )?PRIVATE KEY-----/.test(text)) {
          throw new Error(
            "秘密鍵（BEGIN … PRIVATE KEY）のファイルではありません。",
          );
        }
        if (appKeyInput) appKeyInput.value = text;
        setStatus(
          `${file.name} を読み込みました。「GitHub App を保存」で暗号化して保存したら、ダウンロードした .pem は削除してください。`,
          "info",
        );
      } catch (e) {
        setStatus(errorText(e, "ファイルを読み込めませんでした。"), "error");
      }
    };

    const onAddApp = () =>
      run(async () => {
        if (!unlocked) return;
        const editingApp = editing?.kind === "github-app" ? editing.name : null;
        const name = editingApp ?? appNameInput?.value.trim() ?? "";
        const appId = appIdInput?.value.trim() ?? "";
        const saved = editingApp ? unlocked.entries[editingApp] : undefined;
        // Editing: an empty key keeps the one saved.
        const pem = appKeyInput?.value.trim() ||
          (saved && isAppSecret(saved) ? saved.value : "");
        if (!isSecretName(name)) {
          throw new Error(
            "名前は英字・数字・_ で、英字か _ で始めてください。",
          );
        }
        if (!editingApp && unlocked.entries[name]) {
          throw new Error(
            `${name} はもうあります。変えるときは一覧の「編集」から。`,
          );
        }
        if (!/^(?:\d+|Iv[0-9A-Za-z.]+)$/.test(appId)) {
          throw new Error(
            "App ID（数字）か Client ID（Iv…）を入力してください。",
          );
        }
        // Fail here, not at the first approval, if the key cannot be used.
        await appJwt({ kind: "github-app", appId, value: pem, hosts: [] });
        const app: GithubAppSecret = {
          kind: "github-app",
          appId,
          value: pem,
          hosts: [],
        };
        const entries = { ...unlocked.entries, [name]: app };
        await unlocked.save(entries);
        unlocked.entries = entries;
        names = vaultNames();
        const keyWasNew = !!appKeyInput?.value.trim();
        clearAppForm();
        setStatus(
          keyWasNew
            ? `GitHub App ${name} を保存しました。ダウンロードした .pem は削除してください。`
            : `GitHub App ${name} を保存しました。`,
          "success",
        );
      });

    const clearSecretForm = () => {
      if (editing?.kind === "text") editing = null;
      if (nameInput) nameInput.value = "";
      if (valueInput) valueInput.value = "";
      if (hostsInput) hostsInput.value = "";
      if (relayInput) relayInput.checked = false;
    };

    const clearAppForm = () => {
      if (editing?.kind === "github-app") editing = null;
      if (appNameInput) appNameInput.value = "";
      if (appIdInput) appIdInput.value = "";
      if (appKeyInput) appKeyInput.value = "";
    };

    /** Loads a saved secret into its form. The value is not shown: left empty, it stays. */
    const onEditSecret = (name: string) => {
      const entry = unlocked?.entries[name];
      if (!entry) return;
      clearSecretForm();
      clearAppForm();
      if (isAppSecret(entry)) {
        editing = { name, kind: "github-app" };
        if (appNameInput) appNameInput.value = name;
        if (appIdInput) appIdInput.value = entry.appId;
      } else {
        editing = { name, kind: "text" };
        if (nameInput) nameInput.value = name;
        if (hostsInput) hostsInput.value = entry.hosts.join(" ");
        if (relayInput) relayInput.checked = !!entry.relay;
      }
      handle.update();
      (isAppSecret(entry) ? appCard : secretCard)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    };

    const onCancelEdit = () => {
      clearSecretForm();
      clearAppForm();
      handle.update();
    };

    const onRemoveSecret = (name: string) =>
      run(async () => {
        if (!confirm(`${name} を削除しますか？`)) return;
        if (unlocked) {
          const { [name]: _removed, ...rest } = unlocked.entries;
          await unlocked.save(rest);
          unlocked.entries = rest;
          if (editing?.name === name) onCancelEdit();
        } else {
          // Closed: off the list and out of every approval now, out of the ciphertext at the next
          // unlock (`vault.ts`).
          forgetSecret(name);
        }
        names = vaultNames();
      });

    const onDeleteVault = () => {
      if (!confirm("この端末の秘密をすべて削除しますか？")) return;
      deleteVault();
      vaultExists = false;
      unlocked = null;
      names = {};
      handle.update();
    };

    // --- subscription ---------------------------------------------------------

    const onInstall = () =>
      run(async () => {
        const a2hs = installer();
        if (a2hs.getStatus().canPrompt) {
          const outcome = await a2hs.promptInstall();
          if (outcome === "accepted") {
            setStatus(
              "追加しました。ホーム画面の kagi から開いてください。",
              "success",
            );
          }
          return;
        }
        showA2hsGuide();
      });

    const onBrowserMode = () => {
      chooseBrowserMode();
      browserMode = true;
      handle.update();
    };

    /**
     * Registers this phone as the approver if it is not yet, and turns notifications on. One button,
     * because a push subscription is stored with the registration, over its WebSocket.
     */
    const onSetupPush = () =>
      run(async () => {
        if (!sub) {
          sub = await createSubscription();
          startConnection();
        }
        const conn = connection;
        if (!conn) return;
        await conn.whenOnline();
        try {
          await conn.enablePush();
        } catch (e) {
          // Brave's push service is off by default; the guide says where to turn it on.
          if (createPushGuide().isPushServiceError(e)) {
            showPushGuide({ error: e });
            return;
          }
          throw e;
        }
        setStatus(
          "通知を有効にしました。確認の通知が届きます。",
          "success",
        );
      });

    const onSkipPush = () => {
      markPushDone();
      pushOk = true;
      handle.update();
    };

    /**
     * Turns notifications off, which retires this subscription: the server forgets it and refuses
     * its URL from then on (`unregister`). Turning them on again registers a new URL — which is
     * how the URL is rotated.
     */
    const onTurnOff = () =>
      run(async () => {
        if (
          !confirm(
            "通知を止めると、いまの受付 URL は使えなくなります（エージェントに渡した説明も無効になります）。もう一度有効にすると新しい URL になります。止めますか？",
          )
        ) return;
        const conn = connection;
        if (!conn) throw new Error("サーバーにつながっていません。");
        await conn.unregister();
        connection = null;
        await forgetSubscription();
        forgetSetup();
        // The history is this registration's; a new one starts empty.
        clearHistory();
        history = [];
        deleted = new Map();
        sub = null;
        pushOk = false;
        setStatus(
          "通知を止め、受付 URL を無効にしました。再開するときは「通知を有効にする」を押してください（新しい URL になります）。",
          "success",
        );
      });

    const onEnablePush = onSetupPush;

    // --- requests -------------------------------------------------------------

    const onReject = (tx: Transaction) => {
      connection?.decide(tx.id, false);
    };

    const onApprove = (tx: Transaction) =>
      run(async () => {
        const conn = connection;
        if (!conn) return;
        // Every approval asks for the passkey; the secrets are dropped right after the call.
        const vault = await unlockVault();
        const problem = secretsProblem(tx.request, vault.entries);
        if (problem) throw new Error(problem);

        if (isAppTokenRequest(tx.request)) {
          const app = vault.entries[tx.request.app] as GithubAppSecret;
          conn.decide(tx.id, true);
          try {
            const result = await mintInstallationToken(tx.request, app);
            conn.complete(tx.id, result);
            setStatus(
              "トークンを発行しました（1 時間有効）。リクエスト元が受け取るまでこの画面に保持されます。",
              "success",
            );
          } catch (e) {
            const message = errorText(e, "トークンを発行できませんでした");
            conn.fail(tx.id, message);
            throw new Error(message);
          }
          return;
        }

        if (isGithubApiRequest(tx.request)) {
          const app = vault.entries[tx.request.app] as GithubAppSecret;
          conn.decide(tx.id, true);
          try {
            const result = await callGithubApi(tx.request, app);
            conn.complete(tx.id, result);
            setStatus(
              `GitHub API を呼びました (HTTP ${result.status})。使ったトークンは失効させました。`,
              "success",
            );
          } catch (e) {
            const message = errorText(e, "GitHub API を呼べませんでした");
            conn.fail(tx.id, message);
            throw new Error(message);
          }
          return;
        }

        if (isCreateRepoRequest(tx.request)) {
          const app = vault.entries[tx.request.app] as GithubAppSecret;
          conn.decide(tx.id, true);
          try {
            const result = await createRepository(tx.request, app);
            conn.complete(tx.id, result);
            setStatus(
              `${tx.request.owner}/${tx.request.name} を作成しました。`,
              "success",
            );
          } catch (e) {
            const message = errorText(e, "リポジトリを作成できませんでした");
            conn.fail(tx.id, message);
            throw new Error(message);
          }
          return;
        }

        const request = tx.request;
        const secrets = Object.fromEntries(
          request.secrets.map((name) => [name, vault.entries[name].value]),
        );
        // Judged on the opened vault, not on the clear-text names.
        const relayed = usesRelay(request, vault.entries);
        const subId = sub?.id;
        if (relayed && !subId) {
          throw new Error("この端末は登録されていません。");
        }
        conn.decide(tx.id, true);
        try {
          const result = relayed
            ? await executeRelayed(
              request,
              secrets,
              async (call) => sealedCall(await openRelay(subId!, tx.id), call),
            )
            : await execute(request, secrets);
          conn.complete(tx.id, result);
          setStatus(
            `実行しました${
              relayed ? "（kagi のサーバー経由）" : ""
            } (HTTP ${result.status})。結果はリクエスト元が受け取るまでこの画面に保持されます。`,
            "success",
          );
        } catch (e) {
          const message = errorText(e, "呼び出しに失敗しました");
          conn.fail(tx.id, message);
          // Typically CORS: the API must allow this origin for a browser to call it.
          throw new Error(
            relayed
              ? `呼び出しに失敗しました: ${message}`
              : `呼び出しに失敗しました: ${message}（API が CORS を許可していない可能性があります。その場合は秘密を「kagi のサーバー経由で送る」にして登録し直してください）`,
          );
        }
      });

    // --- view -----------------------------------------------------------------

    const endpoint = (path: string) =>
      isClientEnv ? new URL(path, location.href).href : path;

    // --- setup steps ------------------------------------------------------------

    type Step = "install" | "push" | "vault";
    const STEPS: { step: Step; label: string }[] = [
      { step: "install", label: "ホーム画面" },
      { step: "push", label: "通知" },
      { step: "vault", label: "パスキー" },
    ];

    /** The setup step this phone is on, or null when it is set up. */
    const currentStep = (): Step | null => {
      if (!sub && !standalone && !browserMode) return "install";
      if (!sub || !pushOk) return "push";
      if (!vaultExists) return "vault";
      return null;
    };

    const stepper = (current: Step) => (
      <ol mix={stepperStyle} aria-label="準備">
        {STEPS.map(({ step, label }, i) => (
          <li
            key={step}
            aria-current={step === current ? "step" : undefined}
            data-done={STEPS.findIndex((s) => s.step === current) > i
              ? "1"
              : undefined}
          >
            <span>{i + 1}</span>
            {label}
          </li>
        ))}
      </ol>
    );

    const installStep = () => {
      const a2hs = installer().getStatus();
      return (
        <section mix={cardStyle}>
          <h2>ホーム画面に追加する</h2>
          <p>
            kagi
            はスマホのアプリとして使います。ホーム画面に追加して、そこから開いてください。
          </p>
          {a2hs.support === "in-app-blocked"
            ? (
              <>
                <p mix={mutedStyle}>
                  {a2hs.device.inApp.appLabel ?? "アプリ"}{" "}
                  の中のブラウザーでは使えません。いつものブラウザーで開いてください。
                </p>
                <div mix={rowStyle}>
                  <button
                    type="button"
                    mix={[
                      actionStyle,
                      primaryStyle,
                      on("click", () => void installer().escapeInAppBrowser()),
                    ]}
                  >
                    ブラウザーで開く
                  </button>
                </div>
              </>
            )
            : a2hs.support === "installed"
            ? (
              <p mix={mutedStyle}>
                追加済みです。ホーム画面の <strong>kagi</strong>{" "}
                から開いてください。
              </p>
            )
            : (
              <div mix={rowStyle}>
                <button
                  type="button"
                  disabled={busy}
                  mix={[actionStyle, primaryStyle, on("click", onInstall)]}
                >
                  {a2hs.canPrompt ? "ホーム画面に追加" : "追加のしかたを見る"}
                </button>
              </div>
            )}
          {canUseBrowser() && (
            <p mix={mutedStyle}>
              <button
                type="button"
                mix={[linkButtonStyle, on("click", onBrowserMode)]}
              >
                追加せずにこのブラウザーで続ける
              </button>
            </p>
          )}
        </section>
      );
    };

    const pushStep = () => {
      const status = pushStatus();
      const state = connection?.push ?? null;
      return (
        <section mix={cardStyle}>
          <h2>通知を受け取る</h2>
          <p>
            リクエストが来たら、この端末に通知します。通知を開いて内容を確かめ、パスキーで承認します。
          </p>
          <p mix={mutedStyle}>
            有効にすると、エージェントがリクエストを送る受付 URL
            がこの端末用に作られます。通知を止めるとその URL
            は無効になり、もう一度有効にすると新しい URL になります。
          </p>
          {status.support === "denied" || state === "denied"
            ? (
              <>
                <p mix={mutedStyle}>
                  通知がブロックされています。次の手順で許可してから、もう一度押してください。
                </p>
                <ol mix={stepsStyle}>
                  {createPushGuide().getReenableSteps().map((step, i) => (
                    <li key={i}>{step.text}</li>
                  ))}
                </ol>
              </>
            )
            : status.support === "unsupported" || state === "unsupported"
            ? (
              <p mix={mutedStyle}>
                このブラウザーは通知に対応していません。
                <button
                  type="button"
                  mix={[
                    linkButtonStyle,
                    on("click", () => void showPushGuide()),
                  ]}
                >
                  詳しく
                </button>
              </p>
            )
            : null}
          {state === "unavailable" && (
            <p mix={mutedStyle}>サーバーの通知がまだ設定されていません。</p>
          )}
          <div mix={rowStyle}>
            <button
              type="button"
              disabled={busy}
              mix={[actionStyle, primaryStyle, on("click", onSetupPush)]}
            >
              通知を有効にする
            </button>
          </div>
          {(state === "unsupported" || state === "unavailable") && (
            <p mix={mutedStyle}>
              <button
                type="button"
                mix={[linkButtonStyle, on("click", onSkipPush)]}
              >
                通知なしで続ける
              </button>
              （画面を開いている間だけリクエストが見えます）
            </p>
          )}
        </section>
      );
    };

    const vaultStep = () => (
      <section mix={cardStyle}>
        <h2>パスキーを作る</h2>
        <p>
          API
          のトークンなどの秘密は、この端末の中にだけ、パスキーで暗号化して保存します。サーバーには送りません。承認のたびにパスキーで開きます。
        </p>
        {!passkeys && (
          <p mix={mutedStyle}>
            このブラウザーはパスキーに対応していないようです。
            <button
              type="button"
              mix={[
                linkButtonStyle,
                on("click", () => void showPasskeyGuide()),
              ]}
            >
              詳しく
            </button>
          </p>
        )}
        <div mix={rowStyle}>
          <button
            type="button"
            disabled={busy}
            mix={[actionStyle, primaryStyle, on("click", onCreateVault)]}
          >
            パスキーを作成
          </button>
        </div>
      </section>
    );

    // --- the approver's screen: three tabs -----------------------------------

    const statusLine = () => {
      const state = connection?.state;
      const push = connection?.push ?? null;
      return (
        <div mix={statusLineStyle}>
          <span data-state={state}>
            {state === "online"
              ? "オンライン"
              : state === "connecting"
              ? "接続中…"
              : "オフライン"}
          </span>
          {push && push !== "on" && (
            <span>
              {push === "denied"
                ? "通知はブロック中"
                : push === "off"
                ? "通知オフ"
                : "通知なし"} {push === "off" && (
                <button
                  type="button"
                  disabled={busy}
                  mix={[linkButtonStyle, on("click", onEnablePush)]}
                >
                  有効にする
                </button>
              )}
            </span>
          )}
        </div>
      );
    };

    const pendingCount = () => {
      const now = Date.now();
      return history.filter((tx) => shownStatus(tx, now) === "pending").length;
    };

    // --- history: deleting -------------------------------------------------------

    const startDeleting = () => {
      deleting = true;
      selected = new Set();
      handle.update();
    };

    const stopDeleting = () => {
      deleting = false;
      selected = new Set();
      swipe = null;
      handle.update();
    };

    const onSelectAll = () => {
      selected = selected.size === pastIds.length
        ? new Set()
        : new Set(pastIds);
      handle.update();
    };

    const onDeleteSelected = () => {
      if (selected.size === 0) return;
      if (!confirm(`履歴 ${selected.size} 件を削除しますか？`)) return;
      ({ history, deleted } = removeFromHistory(history, selected, deleted));
      writeHistory(history);
      writeDeleted(deleted);
      stopDeleting();
    };

    /**
     * The row at height `y` in `list`, by the rows' positions rather than by what is under the
     * finger (which may be the tab bar). Above the first row is the first, below the last the last.
     */
    const rowIndexAt = (list: Element, y: number): number | null => {
      const rows = [
        ...list.querySelectorAll<HTMLElement>("[data-history-index]"),
      ];
      if (rows.length === 0) return null;
      for (const row of rows) {
        if (y < row.getBoundingClientRect().bottom) {
          return Number(row.dataset.historyIndex);
        }
      }
      return Number(rows[rows.length - 1].dataset.historyIndex);
    };

    const onSwipeStart = (event: PointerEvent) => {
      if (!deleting || swipe) return;
      const row = (event.target as Element).closest("[data-history-index]");
      if (!row) return;
      const anchor = Number((row as HTMLElement).dataset.historyIndex);
      swipe = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        anchor,
        select: !selected.has(pastIds[anchor]),
        base: new Set(selected),
        active: false,
      };
    };

    const onSwipeMove = (event: PointerEvent) => {
      if (!swipe || event.pointerId !== swipe.pointerId) return;
      if (!swipe.active) {
        const dx = Math.abs(event.clientX - swipe.x);
        const dy = Math.abs(event.clientY - swipe.y);
        if (dx < 8 && dy < 8) return;
        if (dy >= dx) {
          // A scroll: the rows are `touch-action: pan-y`, so the browser has it.
          swipe = null;
          return;
        }
        swipe.active = true;
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      }
      const current = rowIndexAt(
        event.currentTarget as Element,
        event.clientY,
      );
      if (current === null) return;
      selected = selectRange(
        swipe.base,
        pastIds,
        swipe.anchor,
        current,
        swipe.select,
      );
      handle.update();
    };

    const onSwipeEnd = (event: PointerEvent) => {
      if (!swipe || event.pointerId !== swipe.pointerId) return;
      if (!swipe.active) {
        // A tap: just that row.
        selected = selectRange(
          swipe.base,
          pastIds,
          swipe.anchor,
          swipe.anchor,
          swipe.select,
        );
      }
      swipe = null;
      handle.update();
    };

    const onSwipeCancel = () => {
      swipe = null;
    };

    // --- 承認 -------------------------------------------------------------------

    const requestDetails = (tx: Transaction) => (
      <dl mix={detailsStyle}>
        {isAppTokenRequest(tx.request)
          ? appTokenDetails(tx.request)
          : isGithubApiRequest(tx.request)
          ? githubApiDetails(tx.request)
          : isCreateRepoRequest(tx.request)
          ? createRepoDetails(tx.request)
          : httpDetails(tx.request, names)}
        <dt>受付</dt>
        <dd>{formatTime(tx.createdAt)}</dd>
        {tx.error && (
          <>
            <dt>エラー</dt>
            <dd>{tx.error}</dd>
          </>
        )}
      </dl>
    );

    const statusBadge = (status: TxStatus) => (
      <span mix={badgeStyle} data-status={status}>
        {STATUS_LABEL[status]}
      </span>
    );

    /** A request still in play: everything about it, and the buttons while it waits. */
    const openItem = (tx: Transaction, now: number) => {
      const status = shownStatus(tx, now);
      return (
        <li
          key={tx.id}
          mix={[itemStyle, tx.id === focusTx ? focusStyle : null]}
        >
          <div mix={rowStyle}>
            <strong>{headingOf(tx.request)[0]}</strong>
            <strong mix={hostStyle}>{headingOf(tx.request)[1]}</strong>
            {statusBadge(status)}
          </div>
          {requestDetails(tx)}
          {status === "pending" && (
            <div mix={rowStyle}>
              <button
                type="button"
                disabled={busy || connection?.state !== "online"}
                mix={[
                  actionStyle,
                  primaryStyle,
                  on("click", () => void onApprove(tx)),
                ]}
              >
                パスキーで承認して実行
              </button>
              <button
                type="button"
                disabled={connection?.state !== "online"}
                mix={[
                  actionStyle,
                  dangerStyle,
                  on("click", () => onReject(tx)),
                ]}
              >
                拒否
              </button>
            </div>
          )}
        </li>
      );
    };

    /** The one line a finished request folds to: when, what, how it ended. */
    const pastSummary = (tx: Transaction, now: number) => (
      <>
        <time mix={timeStyle} dateTime={new Date(tx.createdAt).toISOString()}>
          {formatTime(tx.createdAt)}
        </time>
        <span mix={pastTitleStyle}>
          <strong>{headingOf(tx.request)[0]}</strong>{" "}
          <span mix={hostStyle}>{headingOf(tx.request)[1]}</span>
        </span>
        {statusBadge(shownStatus(tx, now))}
      </>
    );

    const pastItem = (tx: Transaction, index: number, now: number) =>
      deleting
        ? (
          <li
            key={tx.id}
            data-history-index={String(index)}
            aria-selected={selected.has(tx.id) ? "true" : "false"}
            mix={[pastRowStyle, selectableStyle]}
          >
            <span mix={checkStyle} aria-hidden="true" />
            {pastSummary(tx, now)}
          </li>
        )
        : (
          <li key={tx.id}>
            <details mix={pastFoldStyle}>
              <summary mix={pastRowStyle}>{pastSummary(tx, now)}</summary>
              {requestDetails(tx)}
            </details>
          </li>
        );

    /** 承認: the requests still in play, then the history, folded. */
    const approveTab = () => {
      const now = Date.now();
      const open = history.filter((tx) => !isPast(tx, now));
      const past = history.filter((tx) => isPast(tx, now));
      pastIds = past.map((tx) => tx.id);
      if (deleting && past.length === 0) deleting = false;
      return (
        <>
          {statusLine()}
          {open.length === 0 && (
            <p mix={[mutedStyle, emptyStyle]}>
              承認待ちのリクエストはありません。来たら通知します。
            </p>
          )}
          <ul mix={listStyle}>{open.map((tx) => openItem(tx, now))}</ul>
          {past.length > 0 && (
            <section aria-label="履歴">
              <div mix={historyHeadStyle}>
                <h2>履歴</h2>
                {deleting
                  ? (
                    <>
                      <button
                        type="button"
                        mix={[actionStyle, on("click", stopDeleting)]}
                      >
                        キャンセル
                      </button>
                      <button
                        type="button"
                        disabled={selected.size === 0}
                        mix={[
                          actionStyle,
                          dangerStyle,
                          on("click", onDeleteSelected),
                        ]}
                      >
                        {selected.size ? `${selected.size} 件を削除` : "削除"}
                      </button>
                    </>
                  )
                  : (
                    <button
                      type="button"
                      mix={[actionStyle, on("click", startDeleting)]}
                    >
                      選択して削除
                    </button>
                  )}
              </div>
              {deleting && (
                <p mix={mutedStyle}>
                  行を横にスワイプして、そのまま上下になぞると範囲を選べます。タップで
                  1 件ずつ。{" "}
                  <button
                    type="button"
                    mix={[linkButtonStyle, on("click", onSelectAll)]}
                  >
                    {selected.size === past.length
                      ? "選択を解除"
                      : "すべて選択"}
                  </button>
                </p>
              )}
              <ul
                mix={[
                  pastListStyle,
                  deleting
                    ? [
                      on<HTMLUListElement, "pointerdown">(
                        "pointerdown",
                        onSwipeStart,
                      ),
                      on<HTMLUListElement, "pointermove">(
                        "pointermove",
                        onSwipeMove,
                      ),
                      on<HTMLUListElement, "pointerup">(
                        "pointerup",
                        onSwipeEnd,
                      ),
                      on<HTMLUListElement, "pointercancel">(
                        "pointercancel",
                        onSwipeCancel,
                      ),
                    ]
                    : null,
                ]}
              >
                {past.map((tx, i) => pastItem(tx, i, now))}
              </ul>
            </section>
          )}
        </>
      );
    };

    /** The secrets by name, from the clear-text list; deletable open or closed. */
    const secretList = () => {
      const list = Object.entries(names);
      return (
        <ul mix={listStyle}>
          {list.length === 0 && (
            <li mix={mutedStyle}>
              まだ秘密がありません。
            </li>
          )}
          {list.map(([name, entry]) => (
            <li mix={[itemStyle, secretRowStyle]} key={name}>
              <code>[{name}]</code>
              <span mix={mutedStyle}>{describeSecret(entry)}</span>
              <span mix={rowButtonsStyle}>
                {unlocked && (
                  <button
                    type="button"
                    disabled={busy}
                    aria-pressed={editing?.name === name ? "true" : "false"}
                    mix={[
                      actionStyle,
                      on("click", () => onEditSecret(name)),
                    ]}
                  >
                    編集
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy}
                  mix={[
                    actionStyle,
                    dangerStyle,
                    on("click", () =>
                      void onRemoveSecret(name)),
                  ]}
                >
                  削除
                </button>
              </span>
            </li>
          ))}
        </ul>
      );
    };

    const addSecretCard = () => (
      <section
        mix={[
          cardStyle,
          editing?.kind === "text" ? focusStyle : null,
          ref((n) => (secretCard = n as HTMLElement)),
        ]}
      >
        <h2>
          {editing?.kind === "text" ? `${editing.name} を編集` : "秘密を追加"}
        </h2>
        <div mix={formStyle}>
          <input
            placeholder="名前 (例: GH_SECRET)"
            aria-label="秘密の名前"
            autocomplete="off"
            autocapitalize="characters"
            readonly={editing?.kind === "text"}
            mix={[
              inputStyle,
              ref((n) => (nameInput = n as HTMLInputElement)),
            ]}
          />
          <input
            type="password"
            placeholder={editing?.kind === "text"
              ? "新しい値（空なら今の値のまま）"
              : "値"}
            aria-label="秘密の値"
            autocomplete="off"
            mix={[
              inputStyle,
              ref((n) => (valueInput = n as HTMLInputElement)),
            ]}
          />
          <input
            placeholder="送信を許すホスト (例: api.github.com、空なら制限なし)"
            aria-label="送信を許すホスト"
            autocomplete="off"
            autocapitalize="none"
            mix={[
              inputStyle,
              ref((n) => (hostsInput = n as HTMLInputElement)),
            ]}
          />
          <label mix={checkboxRowStyle}>
            <input
              type="checkbox"
              mix={ref((n) => (relayInput = n as HTMLInputElement))}
            />
            <span>
              kagi のサーバー経由で送る
              <br />
              <span mix={mutedStyle}>
                CORS を許可していない API 向け。承認した 1
                回の呼び出しだけ、使い捨ての Worker
                が代わりに呼びます。呼び出しはその Worker
                向けに暗号化して送るので、kagi
                のサーバー本体は中身を読めません。ホストの指定が必要です。
              </span>
            </span>
          </label>
        </div>
        <div mix={rowStyle}>
          <button
            type="button"
            disabled={busy}
            mix={[actionStyle, primaryStyle, on("click", onAddSecret)]}
          >
            {editing?.kind === "text" ? "上書きして保存" : "追加して保存"}
          </button>
          {editing?.kind === "text" && (
            <button
              type="button"
              disabled={busy}
              mix={[actionStyle, on("click", onCancelEdit)]}
            >
              やめる
            </button>
          )}
        </div>
      </section>
    );

    const addAppCard = () => (
      <section
        mix={[
          cardStyle,
          editing?.kind === "github-app" ? focusStyle : null,
          ref((n) => (appCard = n as HTMLElement)),
        ]}
      >
        <h2>
          {editing?.kind === "github-app"
            ? `${editing.name} を編集`
            : "GitHub App を追加"}
        </h2>
        <p mix={mutedStyle}>
          App の秘密鍵はこの端末から出ません。承認のたびに、指定された
          リポジトリと権限だけに絞ったトークンを発行し、リクエスト元に渡す （1
          時間有効）か、この端末で GitHub API を呼んですぐ失効させます。
        </p>
        <div mix={formStyle}>
          <input
            placeholder="名前 (例: GH_APP)"
            aria-label="GitHub App の名前"
            autocomplete="off"
            autocapitalize="characters"
            readonly={editing?.kind === "github-app"}
            mix={[
              inputStyle,
              ref((n) => (appNameInput = n as HTMLInputElement)),
            ]}
          />
          <input
            placeholder="App ID または Client ID"
            aria-label="GitHub App ID"
            autocomplete="off"
            autocapitalize="none"
            mix={[
              inputStyle,
              ref((n) => (appIdInput = n as HTMLInputElement)),
            ]}
          />
          <label mix={fileLabelStyle}>
            <span>秘密鍵ファイル（.pem）を選ぶ</span>
            <input
              type="file"
              aria-label="GitHub App の秘密鍵ファイル"
              mix={on("change", (event) => {
                void onPickKeyFile(event.currentTarget as HTMLInputElement);
              })}
            />
          </label>
          <textarea
            placeholder={editing?.kind === "github-app"
              ? "新しい秘密鍵（空なら今の鍵のまま）"
              : "または .pem の中身（-----BEGIN RSA PRIVATE KEY----- から END まで）を貼り付け"}
            aria-label="GitHub App の秘密鍵"
            autocomplete="off"
            autocapitalize="none"
            spellcheck={false}
            rows={4}
            mix={[
              inputStyle,
              ref((n) => (appKeyInput = n as HTMLTextAreaElement)),
            ]}
          />
        </div>
        <div mix={rowStyle}>
          <button
            type="button"
            disabled={busy}
            mix={[actionStyle, primaryStyle, on("click", onAddApp)]}
          >
            {editing?.kind === "github-app"
              ? "上書きして保存"
              : "GitHub App を保存"}
          </button>
          {editing?.kind === "github-app" && (
            <button
              type="button"
              disabled={busy}
              mix={[actionStyle, on("click", onCancelEdit)]}
            >
              やめる
            </button>
          )}
        </div>
      </section>
    );

    /** 金庫: the secrets by name, always; their values only once the passkey opens them. */
    const vaultTab = () =>
      unlocked
        ? (
          <>
            <div mix={rowStyle}>
              <span mix={mutedStyle}>開いています</span>
              <button
                type="button"
                mix={[actionStyle, pushEndStyle, on("click", onLock)]}
              >
                閉じる
              </button>
            </div>
            {secretList()}
            {addSecretCard()}
            {addAppCard()}
          </>
        )
        : (
          <>
            <div mix={rowStyle}>
              <span mix={mutedStyle}>閉じています</span>
              <button
                type="button"
                disabled={busy}
                mix={[
                  actionStyle,
                  primaryStyle,
                  pushEndStyle,
                  on("click", onUnlock),
                ]}
              >
                パスキーで開いて編集
              </button>
            </div>
            {secretList()}
            <p mix={mutedStyle}>
              値はこの端末の中にだけ、パスキーで暗号化して保存しています。サーバーには送りません。名前と送信先は暗号化せずに置いているので、閉じていても見えます。閉じたまま削除すると、すぐに使えなくなり、値は次にパスキーで開いたときに消えます。
            </p>
          </>
        );

    const brief = (id: string) =>
      agentBrief({
        base: endpoint(routes.api.sub.register.href({ id })),
        secrets: names,
      });

    const onCopyBrief = (id: string) =>
      run(async () => {
        await navigator.clipboard.writeText(brief(id));
        setStatus(
          "エージェント向けの説明をコピーしました。URL を含むので、渡す相手に気をつけてください。",
          "success",
        );
      });

    const requesterSection = (id: string) => (
      <section mix={cardStyle}>
        <h2>リクエスト元の設定</h2>
        <p mix={mutedStyle}>
          AI エージェントには、この URL と使い方をまとめた説明を渡します。ID
          を知っている人は誰でもリクエストを送れるので、ID
          は秘密にしてください。
        </p>
        <div mix={rowStyle}>
          <button
            type="button"
            disabled={busy}
            mix={[
              actionStyle,
              primaryStyle,
              on("click", () => void onCopyBrief(id)),
            ]}
          >
            エージェント向けの説明をコピー
          </button>
        </div>
        <p mix={mutedStyle}>
          金庫の秘密の名前も含めています（値は含みません）。
        </p>
        <details mix={foldStyle}>
          <summary>内容を見る</summary>
          <pre mix={codeStyle}>{brief(id)}</pre>
        </details>
        <details mix={foldStyle}>
          <summary>curl で試す</summary>
          <pre mix={codeStyle}>{usage(endpoint, id)}</pre>
        </details>
        <details mix={foldStyle}>
          <summary>git push を GitHub App で 1 リポジトリに絞る</summary>
          <p mix={mutedStyle}>エージェント側で:</p>
          <pre mix={codeStyle}>{gitHelperConfig(endpoint, id)}</pre>
        </details>
      </section>
    );

    /** 設定: notifications (and so the URL), the requester's side, and the passkey. */
    const settingsTab = (id: string) => (
      <>
        <section mix={cardStyle}>
          <h2>通知と受付 URL</h2>
          <div mix={rowStyle}>
            <span mix={connection?.push === "on" ? null : mutedStyle}>
              {connection?.push === "on"
                ? "通知: オン"
                : connection?.push === "denied"
                ? "通知: ブロックされています"
                : connection?.push === "off"
                ? "通知: オフ"
                : "通知: 使えません"}
            </span>
            {connection?.push !== "on" && (
              <button
                type="button"
                disabled={busy}
                mix={[
                  actionStyle,
                  primaryStyle,
                  pushEndStyle,
                  on("click", onEnablePush),
                ]}
              >
                通知を有効にする
              </button>
            )}
          </div>
          <p mix={mutedStyle}>
            通知を止めると、いまの受付 URL
            は使えなくなります。もう一度有効にすると新しい URL
            になるので、エージェントに説明を渡し直してください。URL
            が漏れたときは、これで作り直せます。
          </p>
          <div mix={rowStyle}>
            <button
              type="button"
              disabled={busy || connection?.state !== "online"}
              mix={[actionStyle, dangerStyle, on("click", onTurnOff)]}
            >
              通知を止める（URL を無効にする）
            </button>
          </div>
        </section>
        {requesterSection(id)}
        <section mix={cardStyle}>
          <h2>パスキー</h2>
          <p mix={mutedStyle}>
            作り直すと今の秘密は消え、新しいパスキーで空の金庫を作ります。
          </p>
          <div mix={rowStyle}>
            <button
              type="button"
              disabled={busy}
              mix={[actionStyle, on("click", onCreateVault)]}
            >
              パスキーを作り直す
            </button>
            <button
              type="button"
              mix={[actionStyle, dangerStyle, on("click", onDeleteVault)]}
            >
              秘密をすべて削除
            </button>
          </div>
        </section>
        <p mix={[mutedStyle, linksStyle]}>
          <a href={routes.docs.href()}>使い方</a>
          <a href={routes.home.href()}>kagi について</a>
        </p>
      </>
    );

    const alert = () =>
      status && (
        <div role="alert" data-kind={status.kind} mix={alertStyle}>
          <span>{status.message}</span>
        </div>
      );

    /** Setup, or the moment before the browser-only state is read: one scrolling column. */
    const setupScreen = (step: Step | null) => (
      <div mix={scrollStyle}>
        <div mix={columnStyle}>
          <h1>{step ? "はじめる" : TAB_TITLE.approve}</h1>
          {step && stepper(step)}
          {alert()}
          {!loaded && <p mix={mutedStyle} aria-busy="true">…</p>}
          {step === "install" && installStep()}
          {step === "push" && pushStep()}
          {step === "vault" && vaultStep()}
          {step && (
            <p mix={[mutedStyle, linksStyle]}>
              <a href={routes.home.href()}>kagi について</a>
              <a href={routes.docs.href()}>使い方</a>
            </p>
          )}
        </div>
      </div>
    );

    return () => {
      const step = loaded ? currentStep() : null;
      if (!loaded || step || !sub) return setupScreen(step);
      const id = sub.id;
      return (
        <TabView
          label="kagi"
          selected={`#${tab}`}
          tabs={[
            {
              label: TAB_TITLE.approve,
              icon: <ApproveIcon />,
              href: "#approve",
              badge: pendingCount(),
            },
            { label: TAB_TITLE.vault, icon: <VaultIcon />, href: "#vault" },
            {
              label: TAB_TITLE.settings,
              icon: <SettingsIcon />,
              href: "#settings",
            },
          ]}
        >
          <div mix={columnStyle}>
            <h1>{TAB_TITLE[tab]}</h1>
            {alert()}
            {tab === "approve" && approveTab()}
            {tab === "vault" && vaultTab()}
            {tab === "settings" && settingsTab(id)}
          </div>
        </TabView>
      );
    };
  },
);

function safeHost(req: HttpRequest): string {
  try {
    return hostOf(req);
  } catch {
    return req.url;
  }
}

/** What a request is, and what it is about: the line the approver reads first. */
function headingOf(req: KagiRequest): [string, string] {
  if (isAppTokenRequest(req)) return ["GitHub トークン発行", req.owner];
  if (isGithubApiRequest(req)) {
    return [`GitHub API ${methodOf(req)}`, req.path];
  }
  if (isCreateRepoRequest(req)) {
    return ["GitHub リポジトリ作成", `${req.owner}/${req.name}`];
  }
  if (isHttpRequest(req)) return [methodOf(req), safeHost(req)];
  return ["?", ""];
}

function createRepoDetails(req: GithubCreateRepoRequest) {
  return (
    <>
      <dt>リポジトリ</dt>
      <dd>
        <code>{req.owner}/{req.name}</code>
      </dd>
      <dt>公開範囲</dt>
      <dd>
        {req.visibility === "public" ? "公開 (public)" : "非公開 (private)"}
      </dd>
      {req.description !== undefined && (
        <>
          <dt>説明</dt>
          <dd>{req.description}</dd>
        </>
      )}
      <dt>初期コミット</dt>
      <dd>{req.autoInit ? "README で作る" : "なし（空のリポジトリ）"}</dd>
      <dt>使う App</dt>
      <dd>
        <code>[{req.app}]</code>
      </dd>
    </>
  );
}

function describeSecret(entry: SecretSummary): string {
  if (entry.kind === "github-app") return ` → GitHub App (ID ${entry.appId})`;
  const via = entry.relay ? "（kagi のサーバー経由）" : "";
  return entry.hosts.length
    ? ` → ${entry.hosts.join(", ")} のみ${via}`
    : ` → 送信先の制限なし${via}`;
}

/** The repositories and permissions a token is limited to. */
function scopeDetails(req: GithubAppTokenRequest | GithubApiRequest) {
  return (
    <>
      <dt>リポジトリ</dt>
      <dd>
        {req.repositories.map((r) => (
          <div key={r}>
            <code>{req.owner}/{r}</code>
          </div>
        ))}
      </dd>
      <dt>権限</dt>
      <dd>
        {Object.entries(req.permissions).map(([name, level]) => (
          <div key={name}>
            <code>{name}</code>: <strong>{level}</strong>
          </div>
        ))}
      </dd>
      <dt>使う App</dt>
      <dd>
        <code>[{req.app}]</code>
      </dd>
    </>
  );
}

/** What a token request grants, spelled out: this is the whole of what the approver decides. */
function appTokenDetails(req: GithubAppTokenRequest) {
  return (
    <>
      {scopeDetails(req)}
      <dt>有効期限</dt>
      <dd>1 時間（リクエスト元に渡す）</dd>
    </>
  );
}

/** A GitHub API call (the heading names it): its body, and what its token may do. */
function githubApiDetails(req: GithubApiRequest) {
  return (
    <>
      {req.body !== undefined && (
        <>
          <dt>ボディ</dt>
          <dd>
            <pre mix={codeStyle}>{JSON.stringify(req.body, null, 2)}</pre>
          </dd>
        </>
      )}
      {scopeDetails(req)}
      <dt>トークン</dt>
      <dd>この端末で使い、すぐ失効（リクエスト元には渡さない）</dd>
    </>
  );
}

function httpDetails(
  req: HttpRequest,
  names: Record<string, SecretSummary>,
) {
  return (
    <>
      <dt>URL</dt>
      <dd>
        <code>{req.url}</code>
      </dd>
      {usesRelay(req, names) && (
        <>
          <dt>送り方</dt>
          <dd>kagi のサーバー経由（CORS 非対応の API 向け）</dd>
        </>
      )}
      <dt>使う秘密</dt>
      <dd>
        {req.secrets.length
          ? req.secrets.map((s) => <code key={s}>[{s}]</code>)
          : "なし"}
      </dd>
      {req.headers && (
        <>
          <dt>ヘッダー</dt>
          <dd>
            <pre mix={codeStyle}>
              {Object.entries(req.headers)
                .map(([k, v]) => `${k}: ${v}`)
                .join("\n")}
            </pre>
          </dd>
        </>
      )}
      {req.body !== undefined && (
        <>
          <dt>ボディ</dt>
          <dd>
            <pre mix={codeStyle}>
              {typeof req.body === "string"
                ? req.body
                : JSON.stringify(req.body, null, 2)}
            </pre>
          </dd>
        </>
      )}
    </>
  );
}

function gitHelperConfig(
  endpoint: (path: string) => string,
  id: string,
): string {
  const base = endpoint(routes.api.sub.register.href({ id }));
  const host = (() => {
    try {
      return new URL(base).host;
    } catch {
      return "kagi.kbn.one";
    }
  })();
  return `git config --global credential.https://github.com.useHttpPath true
git config --global credential.https://github.com.helper \\
  '!KAGI_URL=${base} deno run --allow-net=${host} --allow-env https://raw.githubusercontent.com/kbn-one/kagi/main/tools/git_credential_kagi.ts'`;
}

function usage(endpoint: (path: string) => string, id: string): string {
  const req = endpoint(routes.api.sub.req.href({ id }));
  const res = endpoint(routes.api.sub.res.href({ id }));
  return `curl -X POST ${req} \\
  -H 'content-type: application/json' \\
  -d '{"secrets":["GH_SECRET"],"url":"https://api.github.com/user",
       "headers":{"authorization":"Bearer [GH_SECRET]"}}'
# → {"transaction_id":"…"}

curl '${res}?transaction_id=…'
# 承認されるまで待ち、結果を一度だけ返す (202 なら再度呼ぶ)`;
}

// --- styles -----------------------------------------------------------------

const mutedStyle = css({ color: color.muted, fontSize: "0.9rem" });

const listStyle = css({ listStyle: "none", padding: 0, margin: "1rem 0" });

const itemStyle = css({
  marginBlock: "0.75rem",
  padding: "0.9rem 1rem",
  border: `1px solid ${color.border}`,
  borderRadius: radius.md,
  background: color.bg,
  display: "flex",
  flexDirection: "column",
  gap: "0.4rem",
});

const secretRowStyle = css({
  flexDirection: "row",
  flexWrap: "wrap",
  alignItems: "center",
});

const rowButtonsStyle = css({
  display: "flex",
  gap: "0.5rem",
  marginInlineStart: "auto",
});

const focusStyle = css({ borderColor: color.accent, borderWidth: "2px" });

const historyHeadStyle = css({
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  marginBlock: "1.5rem 0.5rem",
  "& h2": { margin: 0, marginInlineEnd: "auto", fontSize: "1.2rem" },
});

const pastListStyle = css({
  listStyle: "none",
  padding: 0,
  margin: 0,
  border: `1px solid ${color.border}`,
  borderRadius: radius.md,
  overflow: "hidden",
  "& > li + li": { borderTop: `1px solid ${color.border}` },
});

/** One folded history entry: date, what it was, how it ended. */
const pastRowStyle = css({
  display: "grid",
  gridTemplateColumns: "auto 1fr auto",
  alignItems: "center",
  gap: "0.6rem",
  padding: "0.55rem 0.8rem",
  fontSize: "0.85rem",
  cursor: "pointer",
  listStyle: "none",
  "&::-webkit-details-marker": { display: "none" },
});

const timeStyle = css({
  color: color.muted,
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
});

const pastTitleStyle = css({
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

const pastFoldStyle = css({
  "&[open] > summary": { borderBottom: `1px solid ${color.border}` },
  "& > dl": { padding: "0 0.8rem 0.6rem" },
});

/**
 * A row in delete mode. `pan-y` leaves vertical swipes to scrolling and hands sideways ones to the
 * page, which turns them into a range selection.
 */
const selectableStyle = css({
  gridTemplateColumns: "auto auto 1fr auto",
  touchAction: "pan-y",
  userSelect: "none",
  WebkitUserSelect: "none",
  WebkitTouchCallout: "none",
  "&[aria-selected=true]": {
    background: "color-mix(in srgb, #dc2626 12%, transparent)",
  },
  "&[aria-selected=true] > span:first-child": {
    borderColor: "#dc2626",
    background:
      "#dc2626 url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M4 8.5l2.5 2.5L12 5.5' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\") center / 100% no-repeat",
  },
});

/** The round tick in front of a row in delete mode; filled by {@link selectableStyle}. */
const checkStyle = css({
  width: "1.15rem",
  height: "1.15rem",
  borderRadius: "999px",
  border: `1.5px solid ${color.muted}`,
  boxSizing: "border-box",
});

const hostStyle = css({ fontFamily: font.mono, wordBreak: "break-all" });

const badgeStyle = css({
  padding: "0.1rem 0.5rem",
  borderRadius: "999px",
  background: color.border,
  fontSize: "0.75rem",
  "&[data-status=pending]": {
    background: color.accent,
    color: color.onAccent,
  },
});

const detailsStyle = css({
  display: "grid",
  gridTemplateColumns: "max-content 1fr",
  gap: "0.25rem 1rem",
  margin: "0.5rem 0",
  fontSize: "0.9rem",
  "& dt": { color: color.muted },
  "& dd": { margin: 0, minWidth: 0, wordBreak: "break-all" },
  "& code": { marginInlineEnd: "0.4rem" },
});

const codeStyle = css({
  margin: 0,
  padding: "0.6rem 0.8rem",
  borderRadius: radius.sm,
  background: color.card,
  fontFamily: font.mono,
  fontSize: "0.8rem",
  whiteSpace: "pre-wrap",
  wordBreak: "break-all",
});

const formStyle = css({
  display: "flex",
  flexDirection: "column",
  gap: "0.5rem",
  marginBlock: "0.5rem",
});

const checkboxRowStyle = css({
  display: "flex",
  alignItems: "flex-start",
  gap: "0.5rem",
  "& input": { marginTop: "0.25rem" },
});

const inputStyle = css({
  padding: "0.55rem 0.7rem",
  border: `1px solid ${color.border}`,
  borderRadius: radius.sm,
  background: color.bg,
  color: color.fg,
  font: "inherit",
  // The name of a secret being edited: shown, not changeable.
  "&[readonly]": { color: color.muted, background: color.card },
});

const fileLabelStyle = css({
  display: "flex",
  flexDirection: "column",
  gap: "0.3rem",
  fontSize: "0.9rem",
  "& input": { font: "inherit" },
});

const rowStyle = css({
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: "0.5rem",
  marginBlock: "0.25rem",
});

const linkButtonStyle = css({
  padding: 0,
  border: "none",
  background: "none",
  color: color.accent,
  font: "inherit",
  textDecoration: "underline",
  cursor: "pointer",
});

const stepsStyle = css({ paddingInlineStart: "1.25rem", lineHeight: 1.7 });

const stepperStyle = css({
  display: "flex",
  gap: "0.5rem",
  listStyle: "none",
  padding: 0,
  margin: "0 0 1rem",
  fontSize: "0.85rem",
  color: color.muted,
  "& li": {
    flex: 1,
    display: "flex",
    alignItems: "center",
    gap: "0.4rem",
    paddingBlockEnd: "0.4rem",
    borderBottom: `3px solid ${color.border}`,
  },
  "& li span": {
    display: "inline-grid",
    placeItems: "center",
    width: "1.4rem",
    height: "1.4rem",
    borderRadius: "999px",
    background: color.border,
    color: color.fg,
    fontSize: "0.75rem",
  },
  "& li[data-done]": { borderColor: color.accent },
  "& li[aria-current]": {
    borderColor: color.accent,
    color: color.fg,
    fontWeight: 700,
  },
  "& li[aria-current] span, & li[data-done] span": {
    background: color.accent,
    color: color.onAccent,
  },
});

const statusLineStyle = css({
  display: "flex",
  flexWrap: "wrap",
  gap: "0.75rem",
  fontSize: "0.85rem",
  color: color.muted,
  "& [data-state]::before": {
    content: '""',
    display: "inline-block",
    width: "0.55rem",
    height: "0.55rem",
    marginInlineEnd: "0.35rem",
    borderRadius: "999px",
    background: color.muted,
  },
  "& [data-state=online]::before": { background: "#16a34a" },
});

const foldStyle = css({
  marginBlock: "0.75rem",
  padding: "0.75rem 1rem",
  border: `1px solid ${color.border}`,
  borderRadius: radius.md,
  "& summary": { cursor: "pointer", fontWeight: 600 },
  "&[open] summary": { marginBlockEnd: "0.5rem" },
});

const emptyStyle = css({ marginBlock: "2rem", textAlign: "center" });

/** Pushes a button in a {@link rowStyle} to the row's far end. */
const pushEndStyle = css({ marginInlineStart: "auto" });

const linksStyle = css({
  display: "flex",
  flexWrap: "wrap",
  gap: "1rem",
  marginBlock: "2rem 1rem",
});

/** The setup screen's scroller: the `"app"` frame does not scroll by itself. */
const scrollStyle = css({ height: "100%", overflow: "auto" });

/**
 * The column every screen is set in. The frame is the whole window (`viewport-fit=cover`), so the
 * column keeps clear of the notch, the status bar and the rounded corners itself; the tab bar's
 * side is the tab view's to clear.
 */
const columnStyle = css({
  maxWidth: contentWidth,
  marginInline: "auto",
  paddingBlock: "max(1.25rem, env(safe-area-inset-top)) 1.5rem",
  paddingInline:
    "max(1rem, env(safe-area-inset-left)) max(1rem, env(safe-area-inset-right))",
  "& h1": { fontSize: "2.1rem", marginBlock: "0.5rem 1rem" },
  "& section:first-of-type": { marginTop: "1rem" },
});

// --- tab icons ----------------------------------------------------------------
// Stroked in `currentColor`, so they take the tab bar's colour for selected and not.

const iconProps = {
  width: "24",
  height: "24",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  "stroke-width": "1.8",
  "stroke-linecap": "round",
  "stroke-linejoin": "round",
  "aria-hidden": "true",
} as const;

/** A shield with a check: a request let through. */
function ApproveIcon(_handle: Handle) {
  return () => (
    <svg {...iconProps}>
      <path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6L12 3Z" />
      <path d="m8.75 12 2.25 2.25 4.25-4.5" />
    </svg>
  );
}

/** A safe with its dial. */
function VaultIcon(_handle: Handle) {
  return () => (
    <svg {...iconProps}>
      <rect x="3.5" y="4" width="17" height="15" rx="2.5" />
      <circle cx="12" cy="11.5" r="3.25" />
      <path d="M12 8.25v1.25M12 13.5v1.25M8.75 11.5H10M14 11.5h1.25M7 19v1.5M17 19v1.5" />
    </svg>
  );
}

/** A gear. */
function SettingsIcon(_handle: Handle) {
  return () => (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.54V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.1-1.55 1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.54-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1.1 1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.54V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.54 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1Z" />
    </svg>
  );
}
