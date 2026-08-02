import { BrowserRouter, Routes, Route, NavLink, Navigate, useNavigate } from "react-router-dom";
import { useState, useEffect, useCallback, useRef } from "react";

function NavigationExecutor({ to, onDone }) {
  const navigate = useNavigate();
  useEffect(() => { navigate(to); onDone(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
import Matches from "./pages/Matches";
import Knockouts from "./pages/Knockouts";
import Leaderboard from "./pages/Leaderboard";
import Breakdown from "./pages/Breakdown";
import Champion from "./pages/Champion";
import PLMatchday from "./pages/PLMatchday";
import SeasonPredictions from "./pages/SeasonPredictions";
import LeagueBracket from "./pages/LeagueBracket";
import ViewPicks from "./pages/ViewPicks";
import ViewEPLPicks from "./pages/ViewEPLPicks";
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
import LeagueStats from "./pages/LeagueStats";
import Settings from "./pages/Settings";
import PoolSettings from "./pages/PoolSettings";
import { autoJoinPool, fetchLeaderboard, fetchPoolById, joinPoolById, leavePool, submitIssue, fetchHistory, fetchUserPools, fetchMyIssues, fetchIssueReplies, postIssueReply, fetchPoolPassword, changePoolPassword, renamePool, fetchAnnouncement, updateAnnouncement, fetchPoolAdmins, addPoolAdmin, kickPoolMember, updateChatStatus, fetchChampionUnlock, updateChampionUnlock, fetchChampionW2Lock, updateChampionW2Lock, fetchPlayerAwardsLock, updatePlayerAwardsLock, updatePlayerAwardsVoid, fetchExactScoresSetting, updateExactScoresSetting, fetchGroupStageUnlock, updateGroupStageUnlock, fetchKnockoutMatches, fetchParticipants, fetchMessages } from "./api";
import NotificationsModal from "./components/NotificationsModal";
import DonateModal from "./components/DonateModal";
import AnnouncementPrompt from "./components/AnnouncementModal";
import PasswordInput from "./components/PasswordInput";
import { computeWindowsUnreadCount, fetchWindowsForPool, generateSections, countUnread, applyDismissals } from "./windowsHelpers";
import { localTzLabel } from "./flags";
import { SITE_ORIGIN, isIOS } from "./platform";
import { enablePush, disablePush, setPushOpenHandler } from "./push";
import PushToast from "./components/PushToast";
import { isLeague, hasBracket } from "./leagues";
import "./App.css";

const TOURNAMENT_META = {
  wc2026: { id: "wc2026", name: "World Cup 2026", emoji: "🏆" },
  epl2627: { id: "epl2627", name: "Premier League 26/27", emoji: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
  laliga2627: { id: "laliga2627", name: "La Liga 26/27", emoji: "🇪🇸" },
  seriea2627: { id: "seriea2627", name: "Serie A 26/27", emoji: "🇮🇹" },
  nfl2627: { id: "nfl2627", name: "NFL 26/27", emoji: "🏈" },
  ucl2627: { id: "ucl2627", name: "Champions League 26/27", emoji: "⭐" },
};

// Used when a pool is joined directly (via code or a shared link) rather than through the sport
// picker, so there's no selectedSport to carry over — keyed by pools.sport.
const SPORT_META = {
  soccer: { id: "soccer", name: "Soccer", emoji: "⚽" },
  americanfootball: { id: "americanfootball", name: "American Football", emoji: "🏈" },
  basketball: { id: "basketball", name: "Basketball", emoji: "🏀" },
};

function App() {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem("auth_user");
    return saved ? JSON.parse(saved) : null;
  });
  const [participant, setParticipant] = useState(null);
  const [points, setPoints] = useState(0);

  const [showAdmin, setShowAdmin] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState(null);
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
  const [announcements, setAnnouncements] = useState([]);
  const [announcementIsNew, setAnnouncementIsNew] = useState(false);
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

  // Auto-join pool when user and pool are both set. Admin is a spectator on live pools.
  useEffect(() => {
    if (user && pool && !user.is_admin) {
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
      const items = data.announcements || [];
      setAnnouncements(items);
      if (items.length > 0) {
        const seenAt = Number(localStorage.getItem(`seen_announcement_${currentTournamentId}_${user?.id ?? "guest"}`) || 0);
        const latestAt = data.updatedAt ?? Date.now();
        setAnnouncementIsNew(latestAt > seenAt);
      } else {
        setAnnouncementIsNew(false);
      }
    });
  }, [currentTournamentId, user?.id]);

  // Refresh points whenever participant or pool changes
  useEffect(() => {
    if (participant && pool) {
      fetchLeaderboard(pool.id).then((data) => {
        const me = data.find((p) => p.id === participant.id);
        setPoints(me ? me.points : 0);
      });
    }
  }, [participant, pool]);

  const [exactScoresDisabled, setExactScoresDisabled] = useState(false);
  const [groupStageUnlocked, setGroupStageUnlocked] = useState(false);
  const [hasFinishedKoMatches, setHasFinishedKoMatches] = useState(false);

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
            exactScoresDisabled,
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
  }, [pool, participant, handleUnreadWindows, exactScoresDisabled]);

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
    fetchHistory(participant.id, pool.id)
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
          return fetchHistory(p.participant_id, p.id)
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
    // Runs before the token is cleared below, so the request is still authorised.
    disablePush();
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
    const sport = selectedSport || SPORT_META[poolData.sport] || { id: poolData.sport, name: poolData.sport, emoji: "\uD83C\uDFC6" };
    setSelectedSport(sport);
    const tournament = selectedTournament || TOURNAMENT_META[poolData.tournament] || { id: poolData.tournament, name: poolData.tournament, emoji: "\uD83C\uDFC6" };
    setSelectedTournament(tournament);
    localStorage.setItem(
      "pool_session",
      JSON.stringify({ sport, tournament, pool: poolData })
    );
  };

  const handleAdminViewPicks = (poolData, participantId) => {
    handleJoinPool(poolData);
    setPendingNavigation(`/picks/${participantId}`);
  };

  // Push notifications (native builds only — enablePush no-ops on the web).
  // Registering on every sign-in is intentional: FCM hands back the same token and
  // the backend upsert makes repeats free, but it recovers a token that failed to
  // reach the server the first time.
  useEffect(() => {
    if (!user) return;
    enablePush();
    setPushOpenHandler(async (data) => {
      if (!data?.tournament) return;
      const pools = await fetchUserPools();
      if (!Array.isArray(pools)) return;
      const target = pools.find((p) => p.tournament === data.tournament);
      if (target) handleJoinPool(target);
    });
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  // From a pick-reminder notification card: jump straight to the pick screen
  // that needs attention. poolData is set when the card belongs to a different
  // pool (global bell); null means navigate within the pool we're already in.
  const handleNotifNavigate = (poolData, route) => {
    if (!route) return;
    setShowPatchNotes(false);
    if (poolData && poolData.id !== pool?.id) {
      handleJoinPool(poolData);
    }
    setPendingNavigation(route);
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
  const [showDonate, setShowDonate] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const hamburgerRef = useRef(null);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    function handleClickOutside(e) {
      if (hamburgerRef.current && !hamburgerRef.current.contains(e.target)) {
        setMobileMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [mobileMenuOpen]);
  const [poolPassword, setPoolPassword] = useState(null);
  const [showPoolSettings, setShowPoolSettings] = useState(false);
  const [revealPassword, setRevealPassword] = useState(false);
  const [poolAdmins, setPoolAdmins] = useState([]);
  const [poolMembers, setPoolMembers] = useState([]);
  const [isPoolAdmin, setIsPoolAdmin] = useState(false);
  const [chatClosed, setChatClosed] = useState(false);
  const [championW2Locked, setChampionW2Locked] = useState(false);
  const [championUnlocked, setChampionUnlocked] = useState(false);
  const [playerAwardsLocked, setPlayerAwardsLocked] = useState(false);
  const [playerAwardsVoided, setPlayerAwardsVoided] = useState(false);
  const [kickConfirmUserId, setKickConfirmUserId] = useState(null);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [editingPoolName, setEditingPoolName] = useState(false);
  const [newPoolName, setNewPoolName] = useState("");
  const [renamingPool, setRenamingPool] = useState(false);
  const [renameError, setRenameError] = useState("");
  const [newPoolPassword, setNewPoolPassword] = useState("");
  const [changePasswordError, setChangePasswordError] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [changePasswordSuccess, setChangePasswordSuccess] = useState(false);

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
      fetchChampionUnlock(pool.id).then((data) => {
        if (data && typeof data.champion_unlocked !== "undefined") {
          setChampionUnlocked(!!data.champion_unlocked);
        }
      }).catch(() => {});
      fetchPlayerAwardsLock(pool.id).then((data) => {
        if (data && typeof data.player_awards_locked !== "undefined") {
          setPlayerAwardsLocked(!!data.player_awards_locked);
        }
        if (data && typeof data.player_awards_voided !== "undefined") {
          setPlayerAwardsVoided(!!data.player_awards_voided);
        }
      }).catch(() => {});
      fetchExactScoresSetting(pool.id).then((data) => {
        if (data && typeof data.exact_scores_disabled !== "undefined") {
          setExactScoresDisabled(!!data.exact_scores_disabled);
        }
      }).catch(() => {});
      fetchGroupStageUnlock(pool.id).then((data) => {
        if (data && typeof data.group_stage_unlocked !== "undefined") {
          setGroupStageUnlocked(!!data.group_stage_unlocked);
        }
      }).catch(() => {});
      fetchKnockoutMatches().then((matches) => {
        setHasFinishedKoMatches(Array.isArray(matches) && matches.some((m) => m.status === "finished"));
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

  // From the announcement modal: drop straight into a tournament's pool list. Clears any pool
  // we're currently in (same teardown as Switch Pool) and pre-selects the sport + tournament, so
  // the user lands on "create or join a pool" for the one they clicked.
  const handleAnnouncementSelect = (p) => {
    setPool(null);
    setParticipant(null);
    setPoolPassword(null);
    setShowAdmin(false);
    localStorage.removeItem("pool_session");
    setSelectedSport(SPORT_META[p.sport] || null);
    setSelectedTournament(TOURNAMENT_META[p.tournament] || null);
  };

  const handleSwitchPool = () => {
    setPool(null);
    setParticipant(null);
    setPoolPassword(null);
    setShowPoolSettings(false);
    setRevealPassword(false);
    setShowChangePassword(false);
    setNewPoolPassword("");
    setChangePasswordError("");
    setChangingPassword(false);
    setChangePasswordSuccess(false);
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

  const handleAddAnnouncement = async () => {
    const text = announcementDraft.trim();
    if (!text) return;
    const newItem = { text, createdAt: Date.now() };
    const updated = [...announcements, newItem];
    const res = await updateAnnouncement(updated, currentTournamentId);
    if (res.success) {
      setAnnouncements(updated);
      setAnnouncementDraft("");
      localStorage.setItem(`seen_announcement_${currentTournamentId}_${user?.id ?? "guest"}`, String(newItem.createdAt));
      setAnnouncementIsNew(false);
    }
  };

  const handleDeleteAnnouncement = async (index) => {
    const updated = announcements.filter((_, i) => i !== index);
    await updateAnnouncement(updated, currentTournamentId);
    setAnnouncements(updated);
    if (updated.length === 0) {
      setAnnouncementIsNew(false);
      localStorage.removeItem(`seen_announcement_${currentTournamentId}_${user?.id ?? "guest"}`);
    }
  };

  // Admin-only shortcut into the Admin Dashboard, shown in the auth bar on every
  // pre-pool screen so admins can reach it any time (not just the sport picker).
  const adminDashBtn = user?.is_admin
    ? <button onClick={() => setShowAdmin(true)} className="btn-small btn-admin-dash">Admin Dashboard</button>
    : null;

  // Donate / support shortcut, shown next to Report Issue across the app.
  // App Store guideline 3.1.1 forbids linking out to PayPal/Buy Me a Coffee to
  // pay the developer, so the donate entry points are hidden on iOS builds only.
  const donateBtn = isIOS ? null : <button onClick={() => setShowDonate(true)} className="btn-small btn-donate">Support us ❤️</button>;

  const announcementBar = currentTournamentId && (announcements.length > 0 || !!(user && user.is_admin)) ? (
    <div className="announcement-bar">
      {announcementIsNew && !editingAnnouncement && (
        <span
          className="announcement-new-badge"
          onAnimationEnd={() => {
            setAnnouncementIsNew(false);
            localStorage.setItem(`seen_announcement_${currentTournamentId}_${user?.id ?? "guest"}`, String(Date.now()));
          }}
        >
          NEW
        </span>
      )}
      {announcements.length > 0 && !editingAnnouncement && (() => {
        const seenAt = Number(localStorage.getItem(`seen_announcement_${currentTournamentId}_${user?.id ?? "guest"}`) || 0);
        const ordered = [...announcements].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        return (
          <div className="announcement-text">
            <span>
              {ordered.map((item, i) => (
                <span key={i}>
                  {item.createdAt > seenAt && <span className="ticker-new-label">NEW</span>}
                  {item.text}
                  <span className="announcement-sep" />
                </span>
              ))}
            </span>
          </div>
        );
      })()}
      {!!(user && user.is_admin) && !editingAnnouncement && (
        <button className="btn-small announcement-edit-btn" onClick={() => setEditingAnnouncement(true)}>
          {announcements.length > 0 ? "Edit" : "Add Announcement"}
        </button>
      )}
      {editingAnnouncement && (
        <div className="announcement-editor">
          {announcements.length > 0 && (
            <div className="announcement-list">
              {announcements.map((item, i) => (
                <div key={i} className="announcement-list-item">
                  <span className="announcement-list-text">{item.text}</span>
                  <button className="btn-small btn-danger announcement-delete-btn" onClick={() => handleDeleteAnnouncement(i)}>✕</button>
                </div>
              ))}
            </div>
          )}
          <div className="announcement-add-row">
            <input
              value={announcementDraft}
              onChange={(e) => setAnnouncementDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddAnnouncement(); } }}
              placeholder="New announcement..."
              className="announcement-input"
            />
            <button className="btn-small" onClick={handleAddAnnouncement}>Add</button>
          </div>
          <button className="btn-small" onClick={() => { setEditingAnnouncement(false); setAnnouncementDraft(""); }}>Done</button>
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
          onViewPicks={handleAdminViewPicks}
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
          {adminDashBtn}
          <div className="bell-wrapper">
            <button onClick={handleOpenPatchNotes} className="btn-small btn-bell" title="What's New">🔔</button>
            {(unreadPoints + unreadWindows) > 0 && <span className="notif-badge">{unreadPoints + unreadWindows}</span>}
          </div>
          {donateBtn}
          <button onClick={openIssueChat} className="btn-small btn-report">Report Issue</button>
          <button onClick={handleSignOut} className="btn-small">Sign Out</button>
        </div>
        <SelectSport onSelect={handleSelectSport} />

        {showPatchNotes && (
          <NotificationsModal
            onClose={() => setShowPatchNotes(false)}
            participant={null}
            poolId={null}
            tournament={null}
            onReadPoints={() => setUnreadPoints(0)}
            onUnreadWindows={handleUnreadWindows}
            onNavigate={handleNotifNavigate}
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
        {showDonate && <DonateModal onClose={() => setShowDonate(false)} />}
        {user && <AnnouncementPrompt user={user} onSelectPool={handleAnnouncementSelect} />}
      </div>
    );
  }

  // Step 2: Pick a tournament
  if (!selectedTournament) {
    return (
      <div className="app">
        <div className="auth-bar">
          Signed in as <button onClick={() => setShowSettings(true)} className="btn-link"><strong>{user.display_name}</strong></button>
          {adminDashBtn}
          <div className="bell-wrapper">
            <button onClick={handleOpenPatchNotes} className="btn-small btn-bell" title="What's New">🔔</button>
            {(unreadPoints + unreadWindows) > 0 && <span className="notif-badge">{unreadPoints + unreadWindows}</span>}
          </div>
          {donateBtn}
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
            onNavigate={handleNotifNavigate}
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
        {showDonate && <DonateModal onClose={() => setShowDonate(false)} />}
        {user && <AnnouncementPrompt user={user} onSelectPool={handleAnnouncementSelect} />}
      </div>
    );
  }

  // Step 3: Create or join a pool
  if (!pool) {
    return (
      <div className="app">
        <div className="auth-bar">
          Signed in as <button onClick={() => setShowSettings(true)} className="btn-link"><strong>{user.display_name}</strong></button>
          {adminDashBtn}
          <div className="bell-wrapper">
            <button onClick={handleOpenPatchNotes} className="btn-small btn-bell" title="What's New">🔔</button>
            {(unreadPoints + unreadWindows) > 0 && <span className="notif-badge">{unreadPoints + unreadWindows}</span>}
          </div>
          {donateBtn}
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
            onNavigate={handleNotifNavigate}
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
        {showDonate && <DonateModal onClose={() => setShowDonate(false)} />}
        {user && <AnnouncementPrompt user={user} onSelectPool={handleAnnouncementSelect} />}
      </div>
    );
  }

  // Step 4: The main pool view
  return (
    <BrowserRouter>
      {pendingNavigation && <NavigationExecutor to={pendingNavigation} onDone={() => setPendingNavigation(null)} />}
      <div className="app">
        <header>
          <div className="header-top">
            <div>
              <div className="header-title-row">
                <button className="mobile-back-btn" onClick={handleSwitchPool}>Back</button>
                <div className="mobile-header-controls">
                  <div className="bell-wrapper">
                    <button onClick={handleOpenPatchNotes} className="btn-small btn-bell" title="What's New">🔔</button>
                    {(unreadPoints + unreadWindows) > 0 && <span className="notif-badge">{unreadPoints + unreadWindows}</span>}
                  </div>
                  <div className="hamburger-container" ref={hamburgerRef}>
                    <button className="hamburger-btn" onClick={() => setMobileMenuOpen(!mobileMenuOpen)} aria-label="Menu">
                      <span className={`hamburger-icon ${mobileMenuOpen ? "open" : ""}`}>
                        <span></span><span></span><span></span>
                      </span>
                    </button>
                    <div className={`hamburger-dropdown ${mobileMenuOpen ? "open" : ""}`}>
                      <div className="hamburger-menu-user">
                        <div className="hamburger-avatar-row">
                          {/* Every other display_name render is plain interpolation, which tolerates
                              a missing value; this one calls a string method, so an account without
                              a display_name would throw here and blank the whole app. */}
                          <div className="hamburger-avatar">{(user.display_name || user.username || "?").charAt(0).toUpperCase()}</div>
                          <div className="hamburger-name-col">
                            <button onClick={() => { setShowSettings(true); setMobileMenuOpen(false); }} className="btn-link hamburger-username">{user.display_name || user.username}</button>
                            {!!user.is_admin && <span className="header-admin-badge">Admin</span>}
                            {participant && !user.is_admin && <span className="header-user-points">{points} pts</span>}
                          </div>
                        </div>
                      </div>
                      <hr className="hamburger-divider" />
                      {!!user.is_admin && (
                        <button className="hamburger-item" onClick={() => { setShowAdmin(true); setMobileMenuOpen(false); }}>Admin Dashboard</button>
                      )}
                      {!isLeague(pool.tournament) && (
                      <button className="hamburger-item" onClick={async () => {
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
                        setMobileMenuOpen(false);
                      }}>Pool Settings</button>
                      )}
                      <button onClick={(e) => {
                        const url = `${SITE_ORIGIN}/join/${pool.id}`;
                        navigator.clipboard.writeText(url);
                        const btn = e.currentTarget;
                        btn.textContent = "Copied!";
                        setTimeout(() => { btn.textContent = "Share Link"; setMobileMenuOpen(false); }, 2000);
                      }} className="hamburger-item">Share Link</button>
                      <button onClick={() => { setShowQuitConfirm(true); setMobileMenuOpen(false); }} className="hamburger-item hamburger-signout">Quit Pool</button>
                      <hr className="hamburger-divider" />
                      {!isIOS && <button onClick={() => { setShowDonate(true); setMobileMenuOpen(false); }} className="hamburger-item">Support us ❤️</button>}
                      <button onClick={() => { openIssueChat(); setMobileMenuOpen(false); }} className="hamburger-item">Report Issue</button>
                      <button onClick={() => { handleSignOut(); setMobileMenuOpen(false); }} className="hamburger-item hamburger-signout">Sign Out</button>
                    </div>
                  </div>
                </div>
              </div>
              <h1><span className="pool-title-emoji">{selectedTournament.emoji}</span> {pool.name}</h1>
              <p className="pool-meta">
                {selectedTournament.name}
                <button onClick={handleSwitchPool} className="btn-small">
                  Switch Pool
                </button>
                <button onClick={() => setShowQuitConfirm(true)} className="btn-small btn-quit">
                  Quit Pool
                </button>
                <button onClick={(e) => {
                  const url = `${SITE_ORIGIN}/join/${pool.id}`;
                  navigator.clipboard.writeText(url);
                  const btn = e.currentTarget;
                  btn.textContent = "Copied!";
                  setTimeout(() => { btn.textContent = "Share Link"; }, 2000);
                }} className="btn-small btn-share">
                  Share Link
                </button>
                {!isLeague(pool.tournament) && (
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
                )}
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
                  {adminDashBtn}
                  {donateBtn}
                  <button onClick={openIssueChat} className="btn-small btn-report">Report Issue</button>
                  <button onClick={handleSignOut} className="btn-small">Sign Out</button>
                </span>
                <p className="tz-note">All match times are in {localTzLabel(undefined)}</p>
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
            {isLeague(pool.tournament) ? (<>
              <NavLink to="/">Matchday</NavLink>
              <NavLink to="/season">Season</NavLink>
              {hasBracket(pool.tournament) && <NavLink to="/bracket">Bracket</NavLink>}
            </>) : (<>
              <NavLink to="/">Groups</NavLink>
              <NavLink to="/knockouts">Knockouts</NavLink>
              <NavLink to="/champion">Winner</NavLink>
            </>)}
            <NavLink to="/players">Awards</NavLink>
            <NavLink to="/stats">Stats</NavLink>
            <NavLink to="/leaderboard">Leaderboard</NavLink>
            <NavLink to="/breakdown">Breakdown</NavLink>
            <NavLink to="/chat">Chat</NavLink>
            {isLeague(pool.tournament) && <NavLink to="/settings">Admin Settings</NavLink>}
          </nav>
        </header>

        <main>
          <Routes>
            {isLeague(pool.tournament) ? (<>
              <Route path="/" element={<PLMatchday currentUser={participant} league={pool.tournament} exactScoresDisabled={exactScoresDisabled} />} />
              <Route path="/season" element={<SeasonPredictions currentUser={participant} poolId={pool.id} league={pool.tournament} />} />
              {hasBracket(pool.tournament) && <Route path="/bracket" element={<LeagueBracket currentUser={participant} league={pool.tournament} />} />}
            </>) : (<>
              <Route path="/" element={<Matches currentUser={participant} tournament={pool.tournament} poolId={pool.id} mockDate={pool.mock_date} groupStageUnlocked={groupStageUnlocked} />} />
              <Route path="/knockouts" element={<Knockouts currentUser={participant} tournament={pool.tournament} poolId={pool.id} mockDate={pool.mock_date} exactScoresDisabled={exactScoresDisabled} />} />
              <Route path="/champion" element={<Champion currentUser={participant} tournament={pool.tournament} poolId={pool.id} mockDate={pool.mock_date} />} />
            </>)}
            <Route path="/players" element={<Players currentUser={participant} poolId={pool.id} mockDate={pool.mock_date} tournament={pool.tournament} />} />
            <Route path="/stats" element={isLeague(pool.tournament)
              ? <LeagueStats league={pool.tournament} poolId={pool.id} />
              : <Stats poolId={pool.id} />} />
            <Route path="/leaderboard" element={<Leaderboard poolId={pool.id} tournament={pool.tournament} mockDate={pool.mock_date} />} />
            <Route path="/breakdown" element={<Breakdown currentUser={participant} poolId={pool.id} tournament={pool.tournament} mockDate={pool.mock_date} />} />
            {/* History was merged into Breakdown; redirect old links. */}
            <Route path="/history" element={<Navigate to="/breakdown" replace />} />
            {/* Any route this pool doesn't have falls back to its home tab instead of rendering a
                blank page — /bracket only exists for leagues with a knockout stage, so switching
                from a Champions League pool to any other one while on it would otherwise strand
                you on an empty screen. */}
            <Route path="*" element={<Navigate to="/" replace />} />
            <Route path="/chat" element={<Chat currentUser={participant} poolId={pool.id} chatClosed={chatClosed} />} />
            {isLeague(pool.tournament) && (
              <Route path="/settings" element={<PoolSettings pool={pool} user={user} onRenamed={(name) => setPool({ ...pool, name })} />} />
            )}
            <Route path="/picks/:participantId" element={
              isLeague(pool.tournament)
                ? <ViewEPLPicks poolId={pool.id} currentUser={participant} league={pool.tournament} />
                : <ViewPicks poolId={pool.id} tournament={pool.tournament} mockDate={pool.mock_date} currentUser={participant} />
            } />
          </Routes>
        </main>

        {showPoolSettings && !isLeague(pool.tournament) && (
          <div className="modal-overlay" onClick={() => { setShowPoolSettings(false); setRevealPassword(false); setKickConfirmUserId(null); setShowChangePassword(false); setNewPoolPassword(""); setChangePasswordError(""); setChangingPassword(false); setChangePasswordSuccess(false); setEditingPoolName(false); setRenameError(""); }}>
            <div className="modal-box pool-settings-modal" onClick={(e) => e.stopPropagation()}>
              <h3>Pool Settings</h3>
              <div className="pool-settings-row">
                <span className="pool-settings-label">Pool name</span>
                {editingPoolName ? (
                  <span className="pool-settings-value" style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input
                      type="text"
                      value={newPoolName}
                      onChange={(e) => setNewPoolName(e.target.value)}
                      style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid #1e3a1e", background: "#0b1a0b", color: "#d4e8d4", fontSize: 13, width: 140 }}
                    />
                    <button className="btn-small" disabled={renamingPool} onClick={async () => {
                      if (!newPoolName.trim()) return;
                      setRenamingPool(true);
                      setRenameError("");
                      const res = await renamePool(pool.id, newPoolName.trim());
                      if (res.error) { setRenameError(res.error); setRenamingPool(false); return; }
                      setPool({ ...pool, name: res.name });
                      setEditingPoolName(false);
                      setRenamingPool(false);
                    }}>{renamingPool ? "..." : "Save"}</button>
                    <button className="btn-small" onClick={() => { setEditingPoolName(false); setRenameError(""); }}>Cancel</button>
                    {renameError && <span className="error" style={{ fontSize: 11 }}>{renameError}</span>}
                  </span>
                ) : (
                  <span className="pool-settings-value">
                    {pool.name}
                    {isPoolAdmin && <button className="btn-small" style={{ marginLeft: 8 }} onClick={() => { setNewPoolName(pool.name); setEditingPoolName(true); }}>Edit</button>}
                  </span>
                )}
              </div>
              <div className="pool-settings-row">
                <span className="pool-settings-label">Type</span>
                <span className="pool-settings-value">{pool.is_public ? "Public" : "Private"}</span>
              </div>
              {!pool.is_public && (
                <div className="pool-settings-row" style={{ flexDirection: "column", alignItems: "flex-start", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", width: "100%", justifyContent: "space-between" }}>
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
                      {isPoolAdmin && (
                        <button
                          className="btn-small"
                          style={{ marginLeft: 8 }}
                          onClick={() => { setShowChangePassword((v) => !v); setNewPoolPassword(""); setChangePasswordError(""); }}
                        >
                          {showChangePassword ? "Cancel" : "Change"}
                        </button>
                      )}
                    </span>
                  </div>
                  {showChangePassword && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%" }}>
                      <input
                        className="auth-input"
                        type="text"
                        placeholder="New password"
                        value={newPoolPassword}
                        onChange={(e) => { setNewPoolPassword(e.target.value); setChangePasswordError(""); setChangePasswordSuccess(false); }}
                      />
                      {changePasswordError && <span style={{ color: "#c0392b", fontSize: 13 }}>{changePasswordError}</span>}
                      {changePasswordSuccess && <span style={{ color: "#5a8a5a", fontSize: 13 }}>Password updated.</span>}
                      <button
                        className="btn-submit"
                        style={{ alignSelf: "flex-start" }}
                        disabled={changingPassword}
                        onClick={async () => {
                          if (!newPoolPassword.trim()) { setChangePasswordError("Password cannot be empty"); return; }
                          setChangingPassword(true);
                          setChangePasswordError("");
                          const res = await changePoolPassword(pool.id, newPoolPassword.trim());
                          setChangingPassword(false);
                          if (res.error) { setChangePasswordError(res.error); return; }
                          setPoolPassword(newPoolPassword.trim());
                          setNewPoolPassword("");
                          setChangePasswordSuccess(true);
                        }}
                      >
                        {changingPassword ? "Saving…" : "Save"}
                      </button>
                    </div>
                  )}
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

              {isPoolAdmin && !isLeague(pool.tournament) && (
                <div className="pool-settings-row">
                  <span className="pool-settings-label">Champion Pick (During Groups)</span>
                  <span className="pool-settings-value">
                    <button
                      className={`btn-small ${championUnlocked ? "btn-danger" : ""}`}
                      onClick={async () => {
                        const newVal = !championUnlocked;
                        const res = await updateChampionUnlock(pool.id, newVal);
                        if (!res.error) setChampionUnlocked(newVal);
                      }}
                    >
                      {championUnlocked ? "Unlocked — Lock" : "Locked — Unlock"}
                    </button>
                    {championUnlocked && (
                      <span style={{ fontSize: "0.72rem", color: "#f0a500", marginTop: 4, display: "block", textAlign: "right" }}>
                        ⚠ Players can change their champion pick during group stage
                      </span>
                    )}
                  </span>
                </div>
              )}

              {isPoolAdmin && !isLeague(pool.tournament) && (
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
                  <span className="pool-settings-value" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      className={`btn-small ${playerAwardsLocked ? "btn-danger" : ""}`}
                      disabled={playerAwardsVoided}
                      title={playerAwardsVoided ? "Awards are voided (already frozen)" : ""}
                      onClick={async () => {
                        const newVal = !playerAwardsLocked;
                        const res = await updatePlayerAwardsLock(pool.id, newVal);
                        if (!res.error) setPlayerAwardsLocked(newVal);
                      }}
                    >
                      {playerAwardsLocked ? "Locked — Unlock" : "Open — Lock"}
                    </button>
                    <button
                      className={`btn-small ${playerAwardsVoided ? "btn-danger" : ""}`}
                      title="Voiding freezes the picks and makes the whole section score 0 points. Picks are kept, not deleted."
                      onClick={async () => {
                        const newVal = !playerAwardsVoided;
                        if (newVal && !window.confirm("Void player awards? Picks are kept, but this section will score 0 points for everyone in the pool.")) return;
                        const res = await updatePlayerAwardsVoid(pool.id, newVal);
                        if (!res.error) setPlayerAwardsVoided(newVal);
                      }}
                    >
                      {playerAwardsVoided ? "Voided (0 pts) — Restore" : "Void (0 pts)"}
                    </button>
                  </span>
                </div>
              )}

              {isPoolAdmin && !isLeague(pool.tournament) && (
                <div className="pool-settings-row">
                  <span className="pool-settings-label">Exact Score Bonus</span>
                  <span className="pool-settings-value">
                    <button
                      className={`btn-small ${exactScoresDisabled ? "btn-danger" : ""}`}
                      onClick={async () => {
                        const newVal = !exactScoresDisabled;
                        const res = await updateExactScoresSetting(pool.id, newVal);
                        if (!res.error) setExactScoresDisabled(newVal);
                      }}
                    >
                      {exactScoresDisabled ? "Disabled — Enable" : "Enabled — Disable"}
                    </button>
                    {hasFinishedKoMatches && (
                      <span style={{ fontSize: "0.72rem", color: "#f0a500", marginTop: 4, display: "block", textAlign: "right" }}>
                        ⚠ Affects points for already-finished matches
                      </span>
                    )}
                  </span>
                </div>
              )}

              {isPoolAdmin && !isLeague(pool.tournament) && (
                <div className="pool-settings-row">
                  <span className="pool-settings-label">Group Stage Predictions</span>
                  <span className="pool-settings-value">
                    <button
                      className={`btn-small ${groupStageUnlocked ? "btn-danger" : ""}`}
                      onClick={async () => {
                        const newVal = !groupStageUnlocked;
                        const res = await updateGroupStageUnlock(pool.id, newVal);
                        if (!res.error) setGroupStageUnlocked(newVal);
                      }}
                    >
                      {groupStageUnlocked ? "Unlocked — Lock" : "Locked — Unlock"}
                    </button>
                    {groupStageUnlocked && (
                      <span style={{ fontSize: "0.72rem", color: "#f0a500", marginTop: 4, display: "block", textAlign: "right" }}>
                        ⚠ Groups auto-lock once all their matches finish
                      </span>
                    )}
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
                <button className="btn-submit" onClick={() => { setShowPoolSettings(false); setRevealPassword(false); setKickConfirmUserId(null); setShowChangePassword(false); setNewPoolPassword(""); setChangePasswordError(""); setChangingPassword(false); setChangePasswordSuccess(false); }}>Close</button>
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
        {showDonate && <DonateModal onClose={() => setShowDonate(false)} />}
        {user && <AnnouncementPrompt user={user} onSelectPool={handleAnnouncementSelect} />}

        {showPatchNotes && (
          <NotificationsModal
            onClose={() => setShowPatchNotes(false)}
            participant={participant}
            poolId={pool.id}
            tournament={selectedTournament?.id}
            onReadPoints={() => setUnreadPoints(0)}
            onUnreadWindows={handleUnreadWindows}
            onNavigate={handleNotifNavigate}
            exactScoresDisabled={exactScoresDisabled}
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
        <PasswordInput
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

// App returns early for the auth, invite and loading screens, so the foreground
// push notice is mounted as its own sibling rather than inside any one of them.
function AppRoot() {
  return (
    <>
      <App />
      <PushToast />
    </>
  );
}

export default AppRoot;
