/**
 * KagiApp — the approver's screen on `/kagi`, the home-screen app's start page.
 *
 * Until the phone is set up it walks through three steps, one screen each (`lib/kagi/setup.ts`):
 * add to the home screen, turn notifications on (which also registers this phone as the approver,
 * `lib/kagi/device.ts`), and create the passkey that seals the secrets (`lib/kagi/vault.ts`).
 *
 * Then it is the approver's screen: the requests waiting for a decision, live over the
 * subscription's WebSocket (`lib/kagi/connection.ts`), and below them, folded away, the secrets,
 * what a requester needs to know, and this phone's settings.
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

import { routes } from "../routes.ts";
import {
  actionStyle,
  alertStyle,
  cardStyle,
  dangerStyle,
  primaryStyle,
} from "../theme.ts";
import { color, font, radius } from "../tokens.ts";
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
import { connect, type KagiConnection } from "../lib/kagi/connection.ts";
import {
  createSubscription,
  forgetSubscription,
  readSubscription,
  type Subscription,
} from "../lib/kagi/device.ts";
import {
  appJwt,
  createRepository,
  mintInstallationToken,
} from "../lib/kagi/github_app.ts";
import {
  type GithubAppTokenRequest,
  type GithubCreateRepoRequest,
  type HttpRequest,
  isAppTokenRequest,
  isCreateRepoRequest,
  isHttpRequest,
  isSecretName,
  type KagiRequest,
  methodOf,
  type Transaction,
  type TxStatus,
} from "../lib/kagi/protocol.ts";
import {
  execute,
  type GithubAppSecret,
  hostOf,
  isAppSecret,
  type SecretEntry,
  secretsProblem,
} from "../lib/kagi/substitute.ts";
import {
  createVault,
  deleteVault,
  hasVault,
  passkeysAvailable,
  type UnlockedVault,
  unlockVault,
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

    let sub: Subscription | null = null;
    /** Launched from the home screen. */
    let standalone = false;
    /** The approver chose to carry on in the browser (`setup.ts`). */
    let browserMode = false;
    /** Notifications have worked once on this phone. */
    let pushOk = false;
    let connection: KagiConnection | null = null;
    const focusTx = isClientEnv
      ? new URL(location.href).searchParams.get("tx")
      : null;

    let nameInput: HTMLInputElement | null = null;
    let valueInput: HTMLInputElement | null = null;
    let hostsInput: HTMLInputElement | null = null;
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
        sub = readSubscription();
        standalone = device().isStandalone;
        browserMode = browserModeChosen();
        pushOk = pushDone();
        loaded = true;
        startConnection();
        handle.update();
      }, 0);
      handle.signal.addEventListener("abort", () => connection?.close());
    }

    // --- secrets --------------------------------------------------------------

    const onCreateVault = () =>
      run(async () => {
        if (
          vaultExists &&
          !confirm("今の秘密を消して、新しいパスキーで作り直しますか？")
        ) return;
        unlocked = await createVault();
        vaultExists = true;
        setStatus(
          "パスキーを作成しました。最初の秘密を追加してください。",
          "success",
        );
      });

    const onUnlock = () =>
      run(async () => {
        unlocked = await unlockVault();
      });

    const onLock = () => {
      unlocked = null;
      handle.update();
    };

    const onAddSecret = () =>
      run(async () => {
        if (!unlocked) return;
        const name = nameInput?.value.trim() ?? "";
        const value = valueInput?.value ?? "";
        const hosts = (hostsInput?.value ?? "").split(/[\s,]+/).filter(Boolean);
        if (!isSecretName(name)) {
          throw new Error(
            "名前は英字・数字・_ で、英字か _ で始めてください。",
          );
        }
        if (!value) throw new Error("値を入力してください。");
        const entries = { ...unlocked.entries, [name]: { value, hosts } };
        await unlocked.save(entries);
        unlocked.entries = entries;
        if (nameInput) nameInput.value = "";
        if (valueInput) valueInput.value = "";
        if (hostsInput) hostsInput.value = "";
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
        const name = appNameInput?.value.trim() ?? "";
        const appId = appIdInput?.value.trim() ?? "";
        const pem = appKeyInput?.value.trim() ?? "";
        if (!isSecretName(name)) {
          throw new Error(
            "名前は英字・数字・_ で、英字か _ で始めてください。",
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
        if (appNameInput) appNameInput.value = "";
        if (appIdInput) appIdInput.value = "";
        if (appKeyInput) appKeyInput.value = "";
        setStatus(
          `GitHub App ${name} を保存しました。ダウンロードした .pem は削除してください。`,
          "success",
        );
      });

    const onRemoveSecret = (name: string) =>
      run(async () => {
        if (!unlocked || !confirm(`${name} を削除しますか？`)) return;
        const { [name]: _removed, ...rest } = unlocked.entries;
        await unlocked.save(rest);
        unlocked.entries = rest;
      });

    const onDeleteVault = () => {
      if (!confirm("この端末の秘密をすべて削除しますか？")) return;
      deleteVault();
      vaultExists = false;
      unlocked = null;
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

    const onForget = () =>
      run(async () => {
        if (
          !confirm(
            "この端末の登録を解除しますか？ この ID へのリクエストは誰も承認できなくなります。",
          )
        ) return;
        connection?.close();
        connection = null;
        await forgetSubscription();
        forgetSetup();
        sub = null;
        pushOk = false;
      });

    const onEnablePush = onSetupPush;

    const onDisablePush = () =>
      run(async () => {
        await connection?.disablePush();
      });

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
        conn.decide(tx.id, true);
        try {
          const result = await execute(request, secrets);
          conn.complete(tx.id, result);
          setStatus(
            `実行しました (HTTP ${result.status})。結果はリクエスト元が受け取るまでこの画面に保持されます。`,
            "success",
          );
        } catch (e) {
          // Typically CORS: the API must allow this origin for a browser to call it.
          const message = errorText(e, "呼び出しに失敗しました");
          conn.fail(tx.id, message);
          throw new Error(
            `呼び出しに失敗しました: ${message}（API が CORS を許可していない可能性があります）`,
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

    // --- the approver's screen -------------------------------------------------

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

    const secretEditor = (unlocked: UnlockedVault) => (
      <section mix={cardStyle}>
        <h2>秘密</h2>
        <div>
          <ul mix={listStyle}>
            {Object.keys(unlocked.entries).length === 0 && (
              <li mix={mutedStyle}>まだ秘密がありません。</li>
            )}
            {Object.entries(unlocked.entries).map(([name, entry]) => (
              <li mix={[itemStyle, secretRowStyle]} key={name}>
                <code>[{name}]</code>
                <span mix={mutedStyle}>{describeSecret(entry)}</span>
                <button
                  type="button"
                  mix={[
                    actionStyle,
                    dangerStyle,
                    on("click", () =>
                      void onRemoveSecret(name)),
                  ]}
                >
                  削除
                </button>
              </li>
            ))}
          </ul>
          <div mix={formStyle}>
            <input
              placeholder="名前 (例: GH_SECRET)"
              aria-label="秘密の名前"
              autocomplete="off"
              autocapitalize="characters"
              mix={[
                inputStyle,
                ref((n) => (nameInput = n as HTMLInputElement)),
              ]}
            />
            <input
              type="password"
              placeholder="値"
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
          </div>
          <div mix={rowStyle}>
            <button
              type="button"
              disabled={busy}
              mix={[actionStyle, primaryStyle, on("click", onAddSecret)]}
            >
              追加して保存
            </button>
            <button type="button" mix={[actionStyle, on("click", onLock)]}>
              閉じる
            </button>
            <button
              type="button"
              disabled={busy}
              mix={[actionStyle, on("click", onCreateVault)]}
            >
              パスキーを作り直す
            </button>
          </div>

          <h3>GitHub App を追加</h3>
          <p mix={mutedStyle}>
            App の秘密鍵はこの端末から出ません。リクエスト元には、指定された
            リポジトリと権限だけに絞った 1 時間有効のトークンを、承認のたびに
            発行して渡します。
          </p>
          <div mix={formStyle}>
            <input
              placeholder="名前 (例: GH_APP)"
              aria-label="GitHub App の名前"
              autocomplete="off"
              autocapitalize="characters"
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
              placeholder="または .pem の中身（-----BEGIN RSA PRIVATE KEY----- から END まで）を貼り付け"
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
              GitHub App を保存
            </button>
          </div>
        </div>
      </section>
    );

    const secretsSection = () => (
      <details mix={foldStyle}>
        <summary>秘密</summary>
        <p mix={mutedStyle}>
          この端末の中にだけ、パスキーで暗号化して保存しています。
        </p>
        <div mix={rowStyle}>
          <button
            type="button"
            disabled={busy}
            mix={[actionStyle, primaryStyle, on("click", onUnlock)]}
          >
            パスキーで開いて編集
          </button>
          <button
            type="button"
            mix={[actionStyle, dangerStyle, on("click", onDeleteVault)]}
          >
            すべて削除
          </button>
        </div>
      </details>
    );

    const requesterSection = (id: string) => (
      <details mix={foldStyle}>
        <summary>リクエスト元の設定</summary>
        <p mix={mutedStyle}>
          リクエスト元はこの URL を使います。ID を知っている人は誰でも
          リクエストを送れるので、ID は秘密にしてください。
        </p>
        <pre mix={codeStyle}>{usage(endpoint, id)}</pre>
        <p mix={mutedStyle}>
          git push を GitHub App で 1 リポジトリに絞るなら、エージェント側で:
        </p>
        <pre mix={codeStyle}>{gitHelperConfig(endpoint, id)}</pre>
        <p mix={mutedStyle}>
          詳しくは <a href={routes.docs.href()}>使い方</a>。
        </p>
      </details>
    );

    const deviceSection = () => (
      <details mix={foldStyle}>
        <summary>この端末</summary>
        {connection?.push === "on" && (
          <div mix={rowStyle}>
            <span>通知: オン</span>
            <button
              type="button"
              disabled={busy}
              mix={[actionStyle, on("click", onDisablePush)]}
            >
              通知を止める
            </button>
          </div>
        )}
        <div mix={rowStyle}>
          <button
            type="button"
            disabled={busy}
            mix={[actionStyle, dangerStyle, on("click", onForget)]}
          >
            承認者の登録を解除
          </button>
        </div>
      </details>
    );

    const requestsCard = () => {
      if (!connection) return null;
      const txs = [...connection.transactions.values()].sort((a, b) =>
        b.createdAt - a.createdAt
      );
      return (
        <section mix={cardStyle}>
          <h2>リクエスト</h2>
          {statusLine()}
          {txs.length === 0 && (
            <p mix={mutedStyle}>
              承認待ちのリクエストはありません。来たら通知します。
            </p>
          )}
          <ul mix={listStyle}>
            {txs.map((tx) => (
              <li
                key={tx.id}
                mix={[itemStyle, tx.id === focusTx ? focusStyle : null]}
              >
                <div mix={rowStyle}>
                  <strong>{headingOf(tx.request)[0]}</strong>
                  <strong mix={hostStyle}>{headingOf(tx.request)[1]}</strong>
                  <span mix={badgeStyle} data-status={tx.status}>
                    {STATUS_LABEL[tx.status]}
                  </span>
                </div>
                <dl mix={detailsStyle}>
                  {isAppTokenRequest(tx.request)
                    ? appTokenDetails(tx.request)
                    : isCreateRepoRequest(tx.request)
                    ? createRepoDetails(tx.request)
                    : httpDetails(tx.request)}
                  <dt>受付</dt>
                  <dd>{new Date(tx.createdAt).toLocaleString()}</dd>
                  {tx.error && (
                    <>
                      <dt>エラー</dt>
                      <dd>{tx.error}</dd>
                    </>
                  )}
                </dl>
                {tx.status === "pending" && (
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
            ))}
          </ul>
        </section>
      );
    };

    return () => {
      const step = loaded ? currentStep() : null;
      return (
        <div>
          {step && stepper(step)}
          {status && (
            <div role="alert" data-kind={status.kind} mix={alertStyle}>
              <span>{status.message}</span>
            </div>
          )}
          {!loaded && <p mix={mutedStyle} aria-busy="true">…</p>}
          {step === "install" && installStep()}
          {step === "push" && pushStep()}
          {step === "vault" && vaultStep()}
          {unlocked && secretEditor(unlocked)}
          {loaded && !step && sub && (
            <>
              {requestsCard()}
              {!unlocked && secretsSection()}
              {requesterSection(sub.id)}
              {deviceSection()}
            </>
          )}
        </div>
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

function describeSecret(entry: SecretEntry): string {
  if (isAppSecret(entry)) return ` → GitHub App (ID ${entry.appId})`;
  return entry.hosts.length
    ? ` → ${entry.hosts.join(", ")} のみ`
    : " → 送信先の制限なし";
}

/** What a token request grants, spelled out: this is the whole of what the approver decides. */
function appTokenDetails(req: GithubAppTokenRequest) {
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
      <dt>有効期限</dt>
      <dd>1 時間</dd>
      <dt>使う App</dt>
      <dd>
        <code>[{req.app}]</code>
      </dd>
    </>
  );
}

function httpDetails(req: HttpRequest) {
  return (
    <>
      <dt>URL</dt>
      <dd>
        <code>{req.url}</code>
      </dd>
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
  "& button": { marginInlineStart: "auto" },
});

const focusStyle = css({ borderColor: color.accent, borderWidth: "2px" });

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

const inputStyle = css({
  padding: "0.55rem 0.7rem",
  border: `1px solid ${color.border}`,
  borderRadius: radius.sm,
  background: color.bg,
  color: color.fg,
  font: "inherit",
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
