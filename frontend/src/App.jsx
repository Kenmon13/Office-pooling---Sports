import { BrowserRouter, Routes, Route, NavLink } from "react-router-dom";
import { useState, useEffect, useCallback, useRef } from "react";
import Matches from "./pages/Matches";
import Knockouts from "./pages/Knockouts";
import Leaderboard from "./pages/Leaderboard";
import Champion from "./pages/Champion";
import History from "./pages/History";
import ViewPicks from "./pages/ViewPicks";
import SelectSport from "./pages/SelectSport";
import SelectTournament from "./pages/SelectTournament";
import JoinPool from "./pages/JoinPool";
import AdminPanel from "./pages/AdminPanel";
import Auth from "./pages/Auth";
import Landing from "./pages/Landing";
import Legal from "./pages/Legal";
import Chat from "./pages/Chat";
import Players from "./pages/Players";
import Stats from "./pages/Stats";
import Settings from "./pages/Settings";
import { autoJoinPool, fetchLeaderboard, fetchWC2022Leaderboard, adminAddTestParticipants, adminRandomizePicks, adminSetMockDate, adminClearMockDate, fetchPoolById, joinPoolById, leavePool, submitIssue, fetchHistory, fetchWC2022History, fetchUserPools, fetchMyIssues, fetchIssueReplies, postIssueReply, fetchPoolPassword, fetchAnnouncement, updateAnnouncement, fetchPoolAdmins, addPoolAdmin, kickPoolMember, updateChatStatus, fetchChampionW2Lock, updateChampionW2Lock, fetchPlayerAwardsLock, updatePlayerAwardsLock, fetchParticipants, fetchMessages } from "./api";
import NotificationsModal from "./components/NotificationsModal";
import { computeWindowsUnreadCount, fetchWindowsForPool, generateSections, countUnread, applyDismissals } from "./windowsHelpers";
import { localTzLabel } from "./flags";
import "./App.css";

const TOURNAMENT_META = {
  wc2026: { id: "wc2026", name: "World Cup 2026", emoji: "🏆" },
  wc2022: { id: "wc2022", name: "World Cup 2022", emoji: "🏆" },
};

function App() {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem("auth_user");
    return saved ? JSON.parse(saved) : null;
  });
  const [participant, setParticipant] = useState(null);
  const [points, setPoints] = useState(0);
  const [testTzOffset, setTestTzOffset] = useState(8);

  const [showAdmin, setShowAdmin] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showPatchNotes, setShowPatchNotes] = useState(false);
  const [unreadPoints, setUnreadPoints] = useState(0);
  const [unreadWindows, setUnreadWindowsBadge] = useState(() =>
    parseInt(localStorage.getItem("windows_unread_badge") || "0")
  );
  const handleUnreadWindows = useCallback((count) => {
    setUnreadWindowsBadge(count);
    localStorage.setItem("windows_unread_badge", String(count));
  }, []);
  const [initialAuthView] = useState(() => {
    if (window.location.pathname === "/reset-password") return "reset";
    return null;
  });
  const [selectedSport, setSelectedSport] = useState(() => {
    const saved = localStorage.getItem("pool_session");
    if (!saved) return null;
    return JSON.parse(saved).sport ?? null;
  });
  const [selectedTournament, setSelectedTournament] = useState(() => {
    const saved = localStorage.getItem("pool_session");
    if (!saved) return null;
    const parsed = JSON.parse(saved);
    const t = parsed.tournament ?? null;
    if (!t && parsed.pool?.tournament) {
      return TOURNAMENT_META[parsed.pool.tournament] || { id: parsed.pool.tournament, name: parsed.pool.tournament, emoji: "🏆" };
    }
    return t;
  });
  const [pool, setPool] = useState(() => {
    const saved = localStorage.getItem("pool_session");
    if (!saved) return null;
    return JSON.parse(saved).pool ?? null;
  });

  // Invite link handling
  const [announcement, setAnnouncement] = useState("");
  const [editingAnnouncement, setEditingAnnouncement] = useState(false);
  const [announcementDraft, setAnnouncementDraft] = useState("");
  const [invitePool, setInvitePool] = useState(null);
  const [inviteLoading, setInviteLoading] = useState(() => {
    return /^\/join\/\d+/.test(window.location.pathname);
  });

  useEffect(() => {
    const match = window.location.pathname.match(/^\/join\/(\d+)/);
    if (match) {
      fetchPoolById(match[1]).then((data) => {
        if (!data.error) setInvitePool(data);
        setInviteLoading(false);
      }).catch(() => setInviteLoading(false));
      window.history.replaceState(null, "", "/");
    }
  }, []);

  // Auto-join pool when user and pool are both set.
  // Admin is a spectator on live pools but can join WC2022 for testing predictions.
  useEffect(() => {
    if (user && pool && (!user.is_admin || pool.tournament === "wc2022")) {
      autoJoinPool(user.id, pool.id).then((p) => {
        if (!p.error) setParticipant(p);
      });
    }
  }, [user, pool]);

  // Fetch announcement (tournament-specific)
  const currentTournamentId = pool?.tournament || selectedTournament?.id || null;
  useEffect(() => {
    if (!currentTournamentId) return;
    fetchAnnouncement(currentTournamentId).then((data) => {
      setAnnouncement(data.announcement || "");
    });
  }, [currentTournamentId]);

  // Refresh points whenever participant or pool changes
  useEffect(() => {
    if (participant && pool) {
      const fetchFn = pool.tournament === "wc2022" ? fetchWC2022Leaderboard : fetchLeaderboard;
      fetchFn(pool.id).then((data) => {
        const me = data.find((p) => p.id === participant.id);
        setPoints(me ? me.points : 0);
      });
    }
  }, [participant, pool]);

  // Ref tracking current pool so periodic refresh can check without stale closure
  const poolRef = useRef(pool);
  useEffect(() => { poolRef.current = pool; });

  // Badge: update when picks are saved or when pool/participant changes
  useEffect(() => {
    const refresh = async () => {
      if (pool && participant) {
        try {
          const p = { id: pool.id, tournament: pool.tournament, participant_id: participant.id };
          const data = await fetchWindowsForPool(p);
          const sections = generateSections(new Date(), {
            predDeadline: data.predDeadline,
            koMatches: data.koMatches,
            groups: data.groups,
            koDeadline: data.koDeadline,
            poolPicksData: [{ pool, groupPreds: data.groupPreds, koPreds: data.koPreds, champStatus: data.champStatus, awardPicks: data.awardPicks, awardsLocked: data.awardsLocked }],
          });
          handleUnreadWindows(countUnread(applyDismissals(sections, pool.id)));
        } catch { /* ignore */ }
      } else if (!pool) {
        computeWindowsUnreadCount().then(handleUnreadWindows).catch(() => {});
      }
    };
    refresh();
    window.addEventListener("picks-saved", refresh);
    return () => window.removeEventListener("picks-saved", refresh);
  }, [pool, participant, handleUnreadWindows]);

  // Badge: periodic refresh for server-side changes (global mode only — pool mode handled above)
  useEffect(() => {
    if (!user) return;
    const doRefresh = () => {
      if (poolRef.current) return;
      computeWindowsUnreadCount().then(handleUnreadWindows).catch(() => {});
    };
    doRefresh();
    const id = setInterval(doRefresh, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [user, handleUnreadWindows]);

  // Badge: unread points — per-pool mode
  useEffect(() => {
    if (!participant || !pool) return;
    const lastSeen = localStorage.getItem(`points_last_seen_ts_${pool.id}`) || "";
    const fn = pool.tournament === "wc2022" ? fetchWC2022History : fetchHistory;
    fn(participant.id, pool.id)
      .then((data) => {
        if (!Array.isArray(data)) return;
        const unread = lastSeen ? data.filter((e) => e.event_date > lastSeen).length : data.length;
        setUnreadPoints(unread);
      })
      .catch(() => {});
  }, [participant, pool]);

  // Badge: unread points — global mode (not yet in a pool)
  useEffect(() => {
    if (!user || pool) return;
    fetchUserPools()
      .then((pools) => {
        if (!Array.isArray(pools) || pools.length === 0) return;
        const fetches = pools.map((p) => {
          const lastSeen = localStorage.getItem(`points_last_seen_ts_${p.id}`) || "";
          const fn = p.tournament === "wc2022" ? fetchWC2022History : fetchHistory;
          return fn(p.participant_id, p.id)
            .then((data) => (Array.isArray(data) ? data.filter((e) => !lastSeen || e.event_date > lastSeen).length : 0))
            .catch(() => 0);
        });
        Promise.all(fetches).then((counts) => setUnreadPoints(counts.reduce((a, b) => a + b, 0)));
      })
      .catch(() => {});
  }, [user, pool]);

  const handleOpenPatchNotes = () => {
    setShowPatchNotes(true);
  };

  const handleAuth = (userData) => {
    setUser(userData);
    localStorage.setItem("auth_user", JSON.stringify(userData));
  };

  const handleSignOut = () => {
    setUser(null);
    setParticipant(null);
    setSelectedSport(null);
    setSelectedTournament(null);
    setPool(null);
    localStorage.removeItem("auth_user");
    localStorage.removeItem("auth_token");
    localStorage.removeItem("pool_session");
  };

  const handleSelectSport = (sport) => {
    setSelectedSport(sport);
  };

  const handleJoinPool = (poolData) => {
    setPool(poolData);
    setShowAdmin(false);
    const sport = selectedSport || { id: poolData.sport, name: poolData.sport, emoji: poolData.sport === "soccer" ? "\u26BD" : "\uD83C\uDFC0" };
    setSelectedSport(sport);
    const tournament = selectedTournament || TOURNAMENT_META[poolData.tournament] || { id: poolData.tournament, name: poolData.tournament, emoji: "\uD83C\uDFC6" };
    setSelectedTournament(tournament);
    localStorage.setItem(
      "pool_session",
      JSON.stringify({ sport, tournament, pool: poolData })
    );
  };

  const handleBackToSport = () => {
    setSelectedSport(null);
    setSelectedTournament(null);
  };

  const handleBackToTournament = () => {
    setSelectedTournament(null);
  };

  const [showQuitConfirm, setShowQuitConfirm] = useState(false);
  const [showIssueChat, setShowIssueChat] = useState(false);
  const [poolPassword, setPoolPassword] = useState(null);
  const [showPoolSettings, setShowPoolSettings] = useState(false);
  const [revealPassword, setRevealPassword] = useState(false);
  const [poolAdmins, setPoolAdmins] = useState([]);
  const [poolMembers, setPoolMembers] = useState([]);
  const [isPoolAdmin, setIsPoolAdmin] = useState(false);
  const [chatClosed, setChatClosed] = useState(false);
  const [championW2Locked, setChampionW2Locked] = useState(false);
  const [playerAwardsLocked, setPlayerAwardsLocked] = useState(false);
  const [kickConfirmUserId, setKickConfirmUserId] = useState(null);

  // Load pool admin status and chat_closed when pool changes
  useEffect(() => {
    if (user && pool) {
      fetchPoolAdmins(pool.id).then((data) => {
        if (!data.error && Array.isArray(data)) {
          setPoolAdmins(data);
          setIsPoolAdmin(data.some((a) => a.user_id === user.id));
        }
      }).catch(() => {});
      fetchMessages(pool.id).then((data) => {
        if (data && typeof data.chat_closed !== "undefined") {
          setChatClosed(!!data.chat_closed);
        }
      }).catch(() => {});
      fetchChampionW2Lock(pool.id).then((data) => {
        if (data && typeof data.champion_w2_locked !== "undefined") {
          setChampionW2Locked(!!data.champion_w2_locked);
        }
      }).catch(() => {});
      fetchPlayerAwardsLock(pool.id).then((data) => {
        if (data && typeof data.player_awards_locked !== "undefined") {
          setPlayerAwardsLocked(!!data.player_awards_locked);
        }
      }).catch(() => {});
    }
  }, [user, pool]);

  const [myIssues, setMyIssues] = useState([]);
  const [selectedIssue, setSelectedIssue] = useState(null);
  const [issueReplies, setIssueReplies] = useState([]);
  const [issueText, setIssueText] = useState("");
  const [issueSubmitting, setIssueSubmitting] = useState(false);
  const [issueMsg, setIssueMsg] = useState(null);
  const [issueView, setIssueView] = useState("list"); // "list" | "chat" | "new"

  const openIssueChat = async () => {
    setShowIssueChat(true);
    setIssueView("list");
    setSelectedIssue(null);
    setIssueMsg(null);
    setIssueText("");
    const data = await fetchMyIssues();
    if (!data.error) setMyIssues(data);
  };

  const openIssueThread = async (issue) => {
    setSelectedIssue(issue);
    setIssueView("chat");
    setIssueText("");
    setIssueMsg(null);
    const data = await fetchIssueReplies(issue.id);
    if (!data.error) setIssueReplies(data.replies || []);
  };

  const handleSubmitNewIssue = async () => {
    if (!issueText.trim()) return;
    setIssueSubmitting(true);
    const res = await submitIssue(issueText.trim());
    if (res.error) {
      setIssueMsg({ type: "error", text: res.error });
    } else {
      setIssueText("");
      setIssueMsg(null);
      // Refresh and open the new thread
      const data = await fetchMyIssues();
      if (!data.error) {
        setMyIssues(data);
        const newIssue = data.find((i) => i.id === res.id);
        if (newIssue) openIssueThread(newIssue);
      }
    }
    setIssueSubmitting(false);
  };

  const handleSendReply = async () => {
    if (!issueText.trim() || !selectedIssue) return;
    setIssueSubmitting(true);
    const res = await postIssueReply(selectedIssue.id, issueText.trim());
    if (res.error) {
      setIssueMsg({ type: "error", text: res.error });
    } else {
      setIssueText("");
      setIssueMsg(null);
      const data = await fetchIssueReplies(selectedIssue.id);
      if (!data.error) {
        setIssueReplies(data.replies || []);
        setSelectedIssue(data.issue);
      }
      const list = await fetchMyIssues();
      if (!list.error) setMyIssues(list);
    }
    setIssueSubmitting(false);
  };

  const handleLeavePool = () => {
    setSelectedSport(null);
    setSelectedTournament(null);
    setPool(null);
    setParticipant(null);
    localStorage.removeItem("pool_session");
  };

  const handleSwitchPool = () => {
    setPool(null);
    setParticipant(null);
    setPoolPassword(null);
    setShowPoolSettings(false);
    setRevealPassword(false);
    localStorage.removeItem("pool_session");
  };

  const handleQuitPool = async () => {
    if (!pool) return;
    const res = await leavePool(pool.id);
    if (res.error) {
      alert(res.error);
      return;
    }
    setShowQuitConfirm(false);
    handleLeavePool();
  };

  const announcementBar = currentTournamentId && (!!announcement || !!(user && user.is_admin)) ? (
    <div className="announcement-bar">
      {announcement && !editingAnnouncement && (() => {
        const items = announcement.split("\n").filter(Boolean);
        const renderItems = (prefix) => items.map((line, i) => (
          <span key={`${prefix}-${i}`}>{line}<span className="announcement-sep" /></span>
        ));
        return (
          <div className="announcement-text">
            <span>{renderItems("a")}{renderItems("b")}</span>
          </div>
        );
      })()}
      {!!(user && user.is_admin) && !editingAnnouncement && (
        <button className="btn-small announcement-edit-btn" onClick={() => { setAnnouncementDraft(announcement); setEditingAnnouncement(true); }}>
          {announcement ? "Edit" : "Set Announcement"}
        </button>
      )}
      {editingAnnouncement && (
        <div className="announcement-editor">
          <textarea
            value={announcementDraft}
            onChange={(e) => setAnnouncementDraft(e.target.value)}
            placeholder={"One announcement per line:\nRow 1 — first ticker item\nRow 2 — second ticker item"}
            className="announcement-input"
            rows={3}
          />
          <button className="btn-small" onClick={async () => {
            await updateAnnouncement(announcementDraft, currentTournamentId);
            setAnnouncement(announcementDraft.trim());
            setEditingAnnouncement(false);
          }}>Save</button>
          {announcement && (
            <button className="btn-small btn-danger" onClick={async () => {
              await updateAnnouncement("", currentTournamentId);
              setAnnouncement("");
              setEditingAnnouncement(false);
            }}>Clear</button>
          )}
          <button className="btn-small" onClick={() => setEditingAnnouncement(false)}>Cancel</button>
        </div>
      )}
    </div>
  ) : null;

  // Legal pages — accessible without login
  if (window.location.pathname === "/terms") {
    return (
      <div className="app">
        <Legal onBack={() => { window.location.href = "/"; }} />
      </div>
    );
  }

  // Step 0: Sign in / Sign up / Reset password
  if (!user || initialAuthView === "reset") {
    return (
      <div className="app">
        {initialAuthView === "reset"
          ? <Auth onAuth={handleAuth} initialView={initialAuthView} />
          : <Landing onAuth={handleAuth} initialView={initialAuthView} />
        }
      </div>
    );
  }

  // Invite link flow — after auth, before normal flow
  if (invitePool && !pool) {
    return (
      <div className="app">
        <div className="auth-bar">
          Signed in as <strong>{user.display_name}</strong>
          <button onClick={handleSignOut} className="btn-small">Sign Out</button>
        </div>
        <InviteJoin
          pool={invitePool}
          onJoin={(poolData) => { setInvitePool(null); handleJoinPool(poolData); }}
          onCancel={() => setInvitePool(null)}
        />
      </div>
    );
  }

  if (inviteLoading) {
    return (
      <div className="app">
        <p className="notice">Loading invite...</p>
      </div>
    );
  }

  // Admin panel
  if (showAdmin) {
    return (
      <div className="app">
        <AdminPanel
          user={user}
          onSelectPool={handleJoinPool}
          onBack={() => setShowAdmin(false)}
        />
      </div>
    );
  }

  // Settings page
  if (showSettings) {
    return (
      <div className="app">
        <Settings
          user={user}
          onBack={() => setShowSettings(false)}
          onUpdateUser={(updated) => {
            const newUser = { ...user, email: updated.email, username: updated.username, display_name: updated.display_name };
            setUser(newUser);
            localStorage.setItem("auth_user", JSON.stringify(newUser));
          }}
          onSelectPool={(poolData) => {
            setShowSettings(false);
            handleJoinPool(poolData);
          }}
        />
      </div>
    );
  }

  // Step 1: Pick a sport
  if (!selectedSport) {
    return (
      <div className="app">
        <div className="auth-bar">
          Signed in as <button onClick={() => setShowSettings(true)} className="btn-link"><strong>{user.display_name}</strong></button>
          <div className="bell-wrapper">
            <button onClick={handleOpenPatchNotes} className="btn-small btn-bell" title="What's New">🔔</button>
            {(unreadPoints + unreadWindows) > 0 && <span className="notif-badge">{unreadPoints + unreadWindows}</span>}
          </div>
          <button onClick={openIssueChat} className="btn-small btn-report">Report Issue</button>
          <button onClick={handleSignOut} className="btn-small">Sign Out</button>
        </div>
        <SelectSport onSelect={handleSelectSport} onAdminLogin={user.is_admin ? () => setShowAdmin(true) : null} />

        {showPatchNotes && (
          <NotificationsModal
            onClose={() => setShowPatchNotes(false)}
            participant={null}
            poolId={null}
            tournament={null}
            onReadPoints={() => setUnreadPoints(0)}
            onUnreadWindows={handleUnreadWindows}
          />
        )}
        {showIssueChat && <IssueChatModal
          issueView={issueView} setIssueView={setIssueView}
          myIssues={myIssues} selectedIssue={selectedIssue}
          issueReplies={issueReplies} issueText={issueText}
          setIssueText={setIssueText} issueSubmitting={issueSubmitting}
          issueMsg={issueMsg}
          onClose={() => setShowIssueChat(false)}
          onOpenThread={openIssueThread}
          onSubmitNew={handleSubmitNewIssue}
          onSendReply={handleSendReply}
        />}
      </div>
    );
  }

  // Step 2: Pick a tournament
  if (!selectedTournament) {
    return (
      <div className="app">
        <div className="auth-bar">
          Signed in as <button onClick={() => setShowSettings(true)} className="btn-link"><strong>{user.display_name}</strong></button>
          <div className="bell-wrapper">
            <button onClick={handleOpenPatchNotes} className="btn-small btn-bell" title="What's New">🔔</button>
            {(unreadPoints + unreadWindows) > 0 && <span className="notif-badge">{unreadPoints + unreadWindows}</span>}
          </div>
          <button onClick={openIssueChat} className="btn-small btn-report">Report Issue</button>
          <button onClick={handleSignOut} className="btn-small">Sign Out</button>
        </div>
        {announcementBar}
        <SelectTournament
          sport={selectedSport}
          onSelect={(t) => setSelectedTournament(t)}
          onBack={handleBackToSport}
        />

        {showPatchNotes && (
          <NotificationsModal
            onClose={() => setShowPatchNotes(false)}
            participant={null}
            poolId={null}
            tournament={null}
            onReadPoints={() => setUnreadPoints(0)}
            onUnreadWindows={handleUnreadWindows}
          />
        )}
        {showIssueChat && <IssueChatModal
          issueView={issueView} setIssueView={setIssueView}
          myIssues={myIssues} selectedIssue={selectedIssue}
          issueReplies={issueReplies} issueText={issueText}
          setIssueText={setIssueText} issueSubmitting={issueSubmitting}
          issueMsg={issueMsg}
          onClose={() => setShowIssueChat(false)}
          onOpenThread={openIssueThread}
          onSubmitNew={handleSubmitNewIssue}
          onSendReply={handleSendReply}
        />}
      </div>
    );
  }

  // Step 3: Create or join a pool
  if (!pool) {
    return (
      <div className="app">
        <div className="auth-bar">
          Signed in as <button onClick={() => setShowSettings(true)} className="btn-link"><strong>{user.display_name}</strong></button>
          <div className="bell-wrapper">
            <button onClick={handleOpenPatchNotes} className="btn-small btn-bell" title="What's New">🔔</button>
            {(unreadPoints + unreadWindows) > 0 && <span className="notif-badge">{unreadPoints + unreadWindows}</span>}
          </div>
          <button onClick={openIssueChat} className="btn-small btn-report">Report Issue</button>
          <button onClick={handleSignOut} className="btn-small">Sign Out</button>
        </div>
        {announcementBar}
        <JoinPool
          sport={selectedSport}
          tournament={selectedTournament}
          onJoin={handleJoinPool}
          onBack={handleBackToTournament}
        />

        {showPatchNotes && (
          <NotificationsModal
            onClose={() => setShowPatchNotes(false)}
            participant={null}
            poolId={null}
            tournament={null}
            onReadPoints={() => setUnreadPoints(0)}
            onUnreadWindows={handleUnreadWindows}
          />
        )}
        {showIssueChat && <IssueChatModal
          issueView={issueView} setIssueView={setIssueView}
          myIssues={myIssues} selectedIssue={selectedIssue}
          issueReplies={issueReplies} issueText={issueText}
          setIssueText={setIssueText} issueSubmitting={issueSubmitting}
          issueMsg={issueMsg}
          onClose={() => setShowIssueChat(false)}
          onOpenThread={openIssueThread}
          onSubmitNew={handleSubmitNewIssue}
          onSendReply={handleSendReply}
        />}
      </div>
    );
  }

  // Step 4: The main pool view
  return (
    <BrowserRouter>
      <div className="app">
        <header>
          <div className="header-top">
            <div>
              <h1>{selectedTournament.emoji} {pool.name}</h1>
              <p className="pool-meta">
                {selectedTournament.name}
                <button onClick={handleSwitchPool} className="btn-small">
                  Switch Pool
                </button>
                <button onClick={() => setShowQuitConfirm(true)} className="btn-small btn-quit">
                  Quit Pool
                </button>
                <button onClick={(e) => {
                  const url = `${window.location.origin}/join/${pool.id}`;
                  navigator.clipboard.writeText(url);
                  const btn = e.currentTarget;
                  btn.textContent = "Copied!";
                  setTimeout(() => { btn.textContent = "Share Link"; }, 2000);
                }} className="btn-small btn-share">
                  Share Link
                </button>
                <button className="btn-small" onClick={async () => {
                  if (!pool.is_public && !poolPassword) {
                    const pwRes = await fetchPoolPassword(pool.id);
                    if (!pwRes.error) setPoolPassword(pwRes.password);
                  }
                  const [adminsData, membersData] = await Promise.all([
                    fetchPoolAdmins(pool.id),
                    fetchParticipants(pool.id),
                  ]);
                  if (!adminsData.error && Array.isArray(adminsData)) {
                    setPoolAdmins(adminsData);
                    setIsPoolAdmin(adminsData.some((a) => a.user_id === user.id));
                  }
                  if (!membersData.error && Array.isArray(membersData)) setPoolMembers(membersData);
                  setShowPoolSettings(true);
                }}>
                  Pool Settings
                </button>
              </p>
            </div>
            <div className="header-right">
              <div className="header-user">
                <button onClick={() => setShowSettings(true)} className="btn-link header-user-name">{user.display_name}</button>
                {!!user.is_admin && (
                  <span className="header-admin-badge">Admin</span>
                )}
                {participant && !user.is_admin && (
                  <span className="header-user-points">{points} pts</span>
                )}
                <span className="header-user-actions">
                  <div className="bell-wrapper">
                    <button onClick={handleOpenPatchNotes} className="btn-small btn-bell" title="What's New">🔔</button>
                    {(unreadPoints + unreadWindows) > 0 && <span className="notif-badge">{unreadPoints + unreadWindows}</span>}
                  </div>
                  <button onClick={openIssueChat} className="btn-small btn-report">Report Issue</button>
                  <button onClick={handleSignOut} className="btn-small">Sign Out</button>
                </span>
                <p className="tz-note">All match times are in {localTzLabel(pool?.is_test && user?.is_admin ? testTzOffset : undefined)}</p>
              </div>
              <svg className="soccer-ball" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
                <circle cx="50" cy="50" r="48" fill="#fff" stroke="#222" strokeWidth="2"/>
                <polygon points="50,18 61,30 56,44 44,44 39,30" fill="#222"/>
                <polygon points="75,38 82,52 74,63 62,58 62,44" fill="#222"/>
                <polygon points="68,76 56,82 44,82 32,76 38,63 62,63" fill="#222"/>
                <polygon points="25,38 38,44 38,58 26,63 18,52" fill="#222"/>
                <polygon points="50,6 61,18 39,18" fill="#222" opacity="0.3"/>
                <polygon points="84,30 75,38 62,30 66,18 78,20" fill="#222" opacity="0.3"/>
                <polygon points="16,30 22,20 34,18 38,30 25,38" fill="#222" opacity="0.3"/>
                <polygon points="88,62 82,52 86,40" fill="#222" opacity="0.15"/>
                <polygon points="12,62 14,40 18,52" fill="#222" opacity="0.15"/>
                <polygon points="26,76 18,64 12,72" fill="#222" opacity="0.15"/>
                <polygon points="74,76 82,64 88,72" fill="#222" opacity="0.15"/>
                <polygon points="44,94 44,82 56,82 56,94" fill="#222" opacity="0.15"/>
              </svg>
            </div>
          </div>
          {announcementBar}
          <nav>
            <NavLink to="/">Groups</NavLink>
            <NavLink to="/knockouts">Knockouts</NavLink>
            <NavLink to="/champion">Winner</NavLink>
            <NavLink to="/players">Awards</NavLink>
            <NavLink to="/stats">Stats</NavLink>
            <NavLink to="/leaderboard">Leaderboard</NavLink>
            <NavLink to="/history">History</NavLink>
            <NavLink to="/chat">Chat</NavLink>
          </nav>
        </header>

        <main>
          {!!pool.is_test && !!user.is_admin && (
            <TestControls pool={pool} onMockDateChange={(d) => setPool((p) => ({ ...p, mock_date: d }))} tzOffset={testTzOffset} onTzOffsetChange={setTestTzOffset} />
          )}
          <Routes>
            <Route path="/" element={<Matches currentUser={participant} tournament={pool.tournament} poolId={pool.id} mockDate={pool.mock_date} displayTzOffset={pool.is_test && user.is_admin ? testTzOffset : undefined} />} />
            <Route path="/knockouts" element={<Knockouts currentUser={participant} tournament={pool.tournament} poolId={pool.id} mockDate={pool.mock_date} displayTzOffset={pool.is_test && user.is_admin ? testTzOffset : undefined} />} />
            <Route path="/champion" element={<Champion currentUser={participant} tournament={pool.tournament} poolId={pool.id} mockDate={pool.mock_date} />} />
            <Route path="/players" element={<Players currentUser={participant} poolId={pool.id} mockDate={pool.mock_date} />} />
            <Route path="/stats" element={<Stats poolId={pool.id} />} />
            <Route path="/leaderboard" element={<Leaderboard poolId={pool.id} tournament={pool.tournament} mockDate={pool.mock_date} />} />
            <Route path="/history" element={<History currentUser={participant} tournament={pool.tournament} poolId={pool.id} mockDate={pool.mock_date} />} />
            <Route path="/chat" element={<Chat currentUser={participant} poolId={pool.id} chatClosed={chatClosed} />} />
            <Route path="/picks/:participantId" element={<ViewPicks poolId={pool.id} tournament={pool.tournament} mockDate={pool.mock_date} currentUser={participant} />} />
          </Routes>
        </main>

        {showPoolSettings && (
          <div className="modal-overlay" onClick={() => { setShowPoolSettings(false); setRevealPassword(false); setKickConfirmUserId(null); }}>
            <div className="modal-box pool-settings-modal" onClick={(e) => e.stopPropagation()}>
              <h3>Pool Settings</h3>
              <div className="pool-settings-row">
                <span className="pool-settings-label">Pool name</span>
                <span className="pool-settings-value">{pool.name}</span>
              </div>
              <div className="pool-settings-row">
                <span className="pool-settings-label">Type</span>
                <span className="pool-settings-value">{pool.is_public ? "Public" : "Private"}</span>
              </div>
              {!pool.is_public && (
                <div className="pool-settings-row">
                  <span className="pool-settings-label">Password</span>
                  <span className="pool-settings-value">
                    {revealPassword ? (
                      <span className="pool-password-display">{poolPassword}</span>
                    ) : (
                      <span className="pool-password-hidden">••••••••</span>
                    )}
                    <button className="btn-small" style={{ marginLeft: 8 }} onClick={() => setRevealPassword((v) => !v)}>
                      {revealPassword ? "Hide" : "Reveal"}
                    </button>
                  </span>
                </div>
              )}

              {!pool.is_public && poolAdmins.length === 0 && (
                <div className="pool-settings-row">
                  <span className="pool-settings-label">Admin</span>
                  <span className="pool-settings-value">
                    <span style={{ marginRight: 8, fontSize: 12, color: "#5a8a5a" }}>This pool has no admin.</span>
                    <button
                      className="btn-small"
                      onClick={async () => {
                        const res = await addPoolAdmin(pool.id, user.id);
                        if (!res.error) {
                          setPoolAdmins([{ user_id: user.id, display_name: user.display_name }]);
                          setIsPoolAdmin(true);
                        }
                      }}
                    >
                      Become Admin
                    </button>
                  </span>
                </div>
              )}

              {!pool.is_public && isPoolAdmin && (
                <div className="pool-settings-row">
                  <span className="pool-settings-label">Chat</span>
                  <span className="pool-settings-value">
                    <button
                      className={`btn-small ${chatClosed ? "btn-danger" : ""}`}
                      onClick={async () => {
                        const newVal = !chatClosed;
                        const res = await updateChatStatus(pool.id, newVal);
                        if (!res.error) setChatClosed(newVal);
                      }}
                    >
                      {chatClosed ? "Chat Closed — Reopen" : "Open — Close Chat"}
                    </button>
                  </span>
                </div>
              )}

              {isPoolAdmin && (
                <div className="pool-settings-row">
                  <span className="pool-settings-label">Champion Pick (Window 2)</span>
                  <span className="pool-settings-value">
                    <button
                      className={`btn-small ${championW2Locked ? "btn-danger" : ""}`}
                      onClick={async () => {
                        const newVal = !championW2Locked;
                        const res = await updateChampionW2Lock(pool.id, newVal);
                        if (!res.error) setChampionW2Locked(newVal);
                      }}
                    >
                      {championW2Locked ? "Locked — Unlock" : "Open — Lock"}
                    </button>
                  </span>
                </div>
              )}

              {isPoolAdmin && (
                <div className="pool-settings-row">
                  <span className="pool-settings-label">Player Award Picks</span>
                  <span className="pool-settings-value">
                    <button
                      className={`btn-small ${playerAwardsLocked ? "btn-danger" : ""}`}
                      onClick={async () => {
                        const newVal = !playerAwardsLocked;
                        const res = await updatePlayerAwardsLock(pool.id, newVal);
                        if (!res.error) setPlayerAwardsLocked(newVal);
                      }}
                    >
                      {playerAwardsLocked ? "Locked — Unlock" : "Open — Lock"}
                    </button>
                  </span>
                </div>
              )}

              <h4 style={{ marginTop: 16, marginBottom: 8 }}>Members ({poolMembers.length})</h4>
              <div className="pool-members-list">
                {poolMembers.map((m) => {
                  const mIsAdmin = poolAdmins.some((a) => a.user_id === m.user_id);
                  const isMe = m.user_id === user.id;
                  return (
                    <div key={m.id} className="pool-member-row">
                      <span className="pool-member-name">
                        {m.name}
                        {mIsAdmin && <span className="pool-admin-badge">Admin</span>}
                      </span>
                      {!pool.is_public && isPoolAdmin && !isMe && (
                        <span className="pool-member-actions">
                          {!mIsAdmin && (
                            <button
                              className="btn-small"
                              onClick={async () => {
                                const res = await addPoolAdmin(pool.id, m.user_id);
                                if (!res.error) {
                                  setPoolAdmins((prev) => [...prev, { user_id: m.user_id, display_name: m.name }]);
                                }
                              }}
                            >
                              Make Admin
                            </button>
                          )}
                          {!mIsAdmin && (
                            kickConfirmUserId === m.user_id ? (
                              <span className="kick-confirm">
                                <span>Kick {m.name}?</span>
                                <button
                                  className="btn-small btn-danger"
                                  onClick={async () => {
                                    const res = await kickPoolMember(pool.id, m.user_id);
                                    if (!res.error) {
                                      setPoolMembers((prev) => prev.filter((p) => p.user_id !== m.user_id));
                                      setKickConfirmUserId(null);
                                    }
                                  }}
                                >
                                  Yes
                                </button>
                                <button className="btn-small" onClick={() => setKickConfirmUserId(null)}>No</button>
                              </span>
                            ) : (
                              <button className="btn-small btn-danger" onClick={() => setKickConfirmUserId(m.user_id)}>
                                Kick
                              </button>
                            )
                          )}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="modal-actions">
                <button className="btn-submit" onClick={() => { setShowPoolSettings(false); setRevealPassword(false); setKickConfirmUserId(null); }}>Close</button>
              </div>
            </div>
          </div>
        )}

        {showQuitConfirm && (
          <div className="modal-overlay" onClick={() => setShowQuitConfirm(false)}>
            <div className="modal-box" onClick={(e) => e.stopPropagation()}>
              <h3>Quit Pool</h3>
              <p>Are you sure you want to quit <strong>{pool.name}</strong>? All your predictions and data for this pool will be permanently deleted.</p>
              <div className="modal-actions">
                <button className="btn-submit btn-cancel" onClick={() => setShowQuitConfirm(false)}>Cancel</button>
                <button className="btn-submit btn-danger" onClick={handleQuitPool}>Yes, Quit Pool</button>
              </div>
            </div>
          </div>
        )}

        {showIssueChat && <IssueChatModal
          issueView={issueView} setIssueView={setIssueView}
          myIssues={myIssues} selectedIssue={selectedIssue}
          issueReplies={issueReplies} issueText={issueText}
          setIssueText={setIssueText} issueSubmitting={issueSubmitting}
          issueMsg={issueMsg}
          onClose={() => setShowIssueChat(false)}
          onOpenThread={openIssueThread}
          onSubmitNew={handleSubmitNewIssue}
          onSendReply={handleSendReply}
        />}

        {showPatchNotes && (
          <NotificationsModal
            onClose={() => setShowPatchNotes(false)}
            participant={participant}
            poolId={pool.id}
            tournament={selectedTournament?.id}
            onReadPoints={() => setUnreadPoints(0)}
            onUnreadWindows={handleUnreadWindows}
          />
        )}
      </div>
    </BrowserRouter>
  );
}

function IssueChatModal({ issueView, setIssueView, myIssues, selectedIssue, issueReplies, issueText, setIssueText, issueSubmitting, issueMsg, onClose, onOpenThread, onSubmitNew, onSendReply }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box issue-chat-modal" onClick={(e) => e.stopPropagation()}>
        {issueView === "list" && (
          <>
            <div className="issue-chat-header">
              <h3>Support</h3>
              <button className="btn-submit" onClick={() => { setIssueView("new"); setIssueText(""); }}>New Issue</button>
            </div>
            {myIssues.length === 0 ? (
              <p className="notice">No issues yet. Click "New Issue" to report one.</p>
            ) : (
              <div className="issue-list">
                {myIssues.map((issue) => (
                  <button key={issue.id} className="issue-list-item" onClick={() => onOpenThread(issue)}>
                    <div className="issue-list-top">
                      <span className={`issue-status-badge ${issue.status}`}>{issue.status}</span>
                      <span className="pool-list-meta">{new Date(issue.created_at + "Z").toLocaleDateString()}</span>
                    </div>
                    <p className="issue-list-preview">{issue.body}</p>
                    {issue.reply_count > 0 && <span className="issue-reply-count">{issue.reply_count} repl{issue.reply_count === 1 ? "y" : "ies"}</span>}
                  </button>
                ))}
              </div>
            )}
            <div className="modal-actions">
              <button className="btn-submit btn-cancel" onClick={onClose}>Close</button>
            </div>
          </>
        )}

        {issueView === "new" && (
          <>
            <div className="issue-chat-header">
              <button className="btn-back" onClick={() => setIssueView("list")}>&larr;</button>
              <h3>New Issue</h3>
            </div>
            <p>Describe the issue you are experiencing and we will look into it.</p>
            <textarea
              className="issue-textarea"
              value={issueText}
              onChange={(e) => setIssueText(e.target.value)}
              placeholder="Describe the issue..."
              rows={4}
              autoFocus
            />
            {issueMsg && <div className={`backup-msg ${issueMsg.type}`}>{issueMsg.text}</div>}
            <div className="modal-actions">
              <button className="btn-submit btn-cancel" onClick={() => setIssueView("list")}>Cancel</button>
              <button className="btn-submit" onClick={onSubmitNew} disabled={issueSubmitting || !issueText.trim()}>
                {issueSubmitting ? "Sending..." : "Submit"}
              </button>
            </div>
          </>
        )}

        {issueView === "chat" && selectedIssue && (
          <>
            <div className="issue-chat-header">
              <button className="btn-back" onClick={() => setIssueView("list")}>&larr;</button>
              <h3>Issue #{selectedIssue.id}</h3>
              <span className={`issue-status-badge ${selectedIssue.status}`}>{selectedIssue.status}</span>
            </div>
            <div className="issue-chat-messages">
              <div className="issue-chat-bubble user-bubble">
                <div className="issue-chat-bubble-meta">
                  <strong>{selectedIssue.display_name}</strong>
                  <span>{new Date(selectedIssue.created_at + "Z").toLocaleString()}</span>
                </div>
                <p>{selectedIssue.body}</p>
              </div>
              {issueReplies.map((r) => (
                <div key={r.id} className={`issue-chat-bubble ${r.is_admin ? "admin-bubble" : "user-bubble"}`}>
                  <div className="issue-chat-bubble-meta">
                    <strong>{r.display_name}{r.is_admin ? " (Admin)" : ""}</strong>
                    <span>{new Date(r.created_at + "Z").toLocaleString()}</span>
                  </div>
                  <p>{r.body}</p>
                </div>
              ))}
            </div>
            {issueMsg && <div className={`backup-msg ${issueMsg.type}`}>{issueMsg.text}</div>}
            <div className="issue-chat-input">
              <input
                type="text"
                value={issueText}
                onChange={(e) => setIssueText(e.target.value)}
                placeholder="Type a reply..."
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSendReply(); } }}
                autoFocus
              />
              <button className="btn-submit" onClick={onSendReply} disabled={issueSubmitting || !issueText.trim()}>
                {issueSubmitting ? "..." : "Send"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function utcToLocalParts(utcStr, offsetHours = 8) {
  if (!utcStr) return { date: "", time: "00:00" };
  const local = new Date(new Date(utcStr.replace(" ", "T") + "Z").getTime() + offsetHours * 3600000);
  const iso = local.toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

function offsetToISO(hours) {
  const sign = hours >= 0 ? "+" : "-";
  const abs = Math.abs(hours);
  return `${sign}${String(Math.floor(abs)).padStart(2, "0")}:${String(Math.round((abs % 1) * 60)).padStart(2, "0")}`;
}

function TestControls({ pool, onMockDateChange, tzOffset, onTzOffsetChange }) {
  const [mockDate, setMockDate] = useState(() => utcToLocalParts(pool.mock_date, tzOffset).date);
  const [mockTime, setMockTime] = useState(() => utcToLocalParts(pool.mock_date, tzOffset).time);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  // Re-display the stored mock date whenever tzOffset or the stored date changes
  const syncKey = `${pool.mock_date ?? ""}|${tzOffset}`;
  const [lastSyncKey, setLastSyncKey] = useState(syncKey);
  if (lastSyncKey !== syncKey) {
    setLastSyncKey(syncKey);
    const { date, time } = utcToLocalParts(pool.mock_date, tzOffset);
    setMockDate(date || "");
    setMockTime(time);
  }

  const flash = (text) => { setMsg(text); setTimeout(() => setMsg(""), 2500); };

  const syncInputs = (utcStr) => {
    const { date, time } = utcToLocalParts(utcStr, tzOffset);
    setMockDate(date);
    setMockTime(time);
  };

  const adjustDate = async (offsetMs) => {
    setBusy(true);
    const base = pool.mock_date ? new Date(pool.mock_date.replace(" ", "T") + "Z") : new Date();
    const next = new Date(base.getTime() + offsetMs);
    const utcStr = next.toISOString().slice(0, 16).replace("T", " ");
    await adminSetMockDate(pool.id, utcStr);
    onMockDateChange(utcStr);
    syncInputs(utcStr);
    flash("Date adjusted");
    setBusy(false);
  };

  const applyDate = async () => {
    if (!mockDate) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(mockDate)) { flash("Date: YYYY-MM-DD"); return; }
    if (!/^\d{2}:\d{2}$/.test(mockTime)) { flash("Time: HH:MM"); return; }
    setBusy(true);
    const utcStr = new Date(`${mockDate}T${mockTime}${offsetToISO(tzOffset)}`).toISOString().slice(0, 16).replace("T", " ");
    await adminSetMockDate(pool.id, utcStr);
    onMockDateChange(utcStr);
    flash("Date set");
    setBusy(false);
  };

  const clearDate = async () => {
    setBusy(true);
    await adminClearMockDate(pool.id);
    setMockDate("");
    setMockTime("00:00");
    onMockDateChange(null);
    flash("Using real time");
    setBusy(false);
  };

  const addPlayers = async (n) => {
    setBusy(true);
    const res = await adminAddTestParticipants(pool.id, n);
    flash(res.added?.length ? `Added ${res.added.length} player(s)` : (res.error || "No more names available"));
    setBusy(false);
  };

  const randomize = async () => {
    setBusy(true);
    const res = await adminRandomizePicks(pool.id);
    flash(res.success ? `Randomized picks for ${res.participants} players` : (res.error || "Error"));
    setBusy(false);
  };

  const H = 3600000;
  const D = 86400000;

  return (
    <div className="test-controls">
      <span className="test-badge">TEST POOL</span>
      <div className="test-controls-actions">
        <button className="btn-test" onClick={() => addPlayers(5)} disabled={busy}>+5 Players</button>
        <button className="btn-test" onClick={() => addPlayers(1)} disabled={busy}>+1 Player</button>
        <button className="btn-test" onClick={randomize} disabled={busy}>Randomize Picks</button>
        <span className="test-divider" />
        <span className="test-date-label">Sim time (UTC<input type="number" className="test-tz-input" value={tzOffset} min="-12" max="14" onChange={(e) => onTzOffsetChange(Number(e.target.value))} />):</span>
        <input type="text" className="test-date-input" placeholder="YYYY-MM-DD" value={mockDate} onChange={(e) => setMockDate(e.target.value)} />
        <div className="test-spin">
          <button className="btn-spin" onClick={() => adjustDate(D)} disabled={busy}>▲</button>
          <button className="btn-spin" onClick={() => adjustDate(-D)} disabled={busy}>▼</button>
        </div>
        <input type="text" className="test-date-input test-time-input" placeholder="HH:MM" value={mockTime} onChange={(e) => setMockTime(e.target.value)} />
        <div className="test-spin">
          <button className="btn-spin" onClick={() => adjustDate(H)} disabled={busy}>▲</button>
          <button className="btn-spin" onClick={() => adjustDate(-H)} disabled={busy}>▼</button>
        </div>
        <button className="btn-test" onClick={applyDate} disabled={busy || !mockDate}>Set</button>
        {pool.mock_date && (
          <button className="btn-test btn-test-clear" onClick={clearDate} disabled={busy}>Clear</button>
        )}
      </div>
      {msg && <span className="test-msg">{msg}</span>}
    </div>
  );
}

function InviteJoin({ pool, onJoin, onCancel }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [joining, setJoining] = useState(pool.is_public);
  const [joinResult, setJoinResult] = useState(null);

  useEffect(() => {
    if (pool.is_public) {
      joinPoolById(pool.id, "").then((result) => {
        if (result.error) {
          setError(result.error);
          setJoining(false);
        } else {
          setJoinResult(result);
        }
      });
    }
  }, [pool]);

  useEffect(() => {
    if (joinResult) onJoin(joinResult);
  }, [joinResult, onJoin]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setJoining(true);
    const result = await joinPoolById(pool.id, password.trim());
    if (result.error) {
      setError(result.error);
      setJoining(false);
    } else {
      onJoin(result);
    }
  };

  if (pool.is_public) {
    return (
      <div className="select-page">
        <p className="select-subtitle">Joining <strong>{pool.name}</strong>...</p>
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  return (
    <div className="select-page">
      <h2>Join "{pool.name}"</h2>
      <p className="select-subtitle">This pool requires a password to join.</p>
      <form onSubmit={handleSubmit} className="pool-form-vertical">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Pool password"
          autoFocus
        />
        <button type="submit" disabled={joining}>
          {joining ? "Joining..." : "Join Pool"}
        </button>
        {error && <p className="error">{error}</p>}
      </form>
      <button className="btn-small" onClick={onCancel} style={{ marginTop: 12 }}>Cancel</button>
    </div>
  );
}

export default App;
