import { useState, useEffect, useRef } from "react";
import { fetchMessages, sendMessage } from "../api";

const EMOJI_LIST = [
  "😀","😂","🤣","😊","😍","🥳","😎","🤔","😤","😭",
  "🔥","💯","👍","👎","👏","🙌","💪","🎉","🏆","⚽",
  "🏀","🏈","⚾","🎯","🤞","❤️","💔","😱","🤡","💀",
  "👀","🫡","🤝","✅","❌","⏳","💰","🍀","🥇","🥈",
];

function Chat({ currentUser, poolId, chatClosed }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const messagesEndRef = useRef(null);
  const lastIdRef = useRef(0);
  const isAtBottomRef = useRef(true);
  const inputRef = useRef(null);
  const emojiPickerRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const handleScroll = (e) => {
    const el = e.target;
    isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  // Initial load + polling
  useEffect(() => {
    let active = true;

    const poll = async () => {
      const data = await fetchMessages(poolId, lastIdRef.current);
      if (!active || data.error) return;
      const msgs = data.messages || data;
      if (Array.isArray(msgs) && msgs.length > 0) {
        lastIdRef.current = msgs[msgs.length - 1].id;
        setMessages((prev) => {
          const existingIds = new Set(prev.map((m) => m.id));
          const newMsgs = msgs.filter((m) => !existingIds.has(m.id));
          return newMsgs.length > 0 ? [...prev, ...newMsgs] : prev;
        });
      }
    };

    // Initial fetch (all messages)
    fetchMessages(poolId).then((data) => {
      if (!active || data.error) return;
      const msgs = data.messages || data;
      if (Array.isArray(msgs)) {
        setMessages(msgs);
        if (msgs.length > 0) lastIdRef.current = msgs[msgs.length - 1].id;
      }
      setTimeout(scrollToBottom, 50);
    });

    const interval = setInterval(poll, 5000);
    return () => { active = false; clearInterval(interval); };
  }, [poolId]);

  // Auto-scroll when new messages arrive (only if already at bottom)
  useEffect(() => {
    if (isAtBottomRef.current) scrollToBottom();
  }, [messages]);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!input.trim() || sending) return;
    setSending(true);
    const result = await sendMessage(poolId, input.trim());
    if (!result.error) {
      setInput("");
      // Add immediately so sender sees it instantly
      setMessages((prev) => {
        if (prev.some((m) => m.id === result.id)) return prev;
        return [...prev, result];
      });
      lastIdRef.current = Math.max(lastIdRef.current, result.id);
      isAtBottomRef.current = true;
      setTimeout(scrollToBottom, 50);
    }
    setSending(false);
  };

  const formatTime = (dateStr) => {
    if (!dateStr) return "";
    const d = new Date(dateStr.endsWith("Z") ? dateStr : dateStr + "Z");
    const now = new Date();
    const diffMs = now - d;
    const diffDays = Math.floor(diffMs / 86400000);

    const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (diffDays === 0) return time;
    if (diffDays === 1) return `Yesterday ${time}`;
    if (diffDays < 7) return `${d.toLocaleDateString([], { weekday: "short" })} ${time}`;
    return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
  };

  // Close emoji picker on outside click
  useEffect(() => {
    if (!showEmojiPicker) return;
    const handleClick = (e) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target)) {
        setShowEmojiPicker(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showEmojiPicker]);

  const insertEmoji = (emoji) => {
    setInput((prev) => prev + emoji);
    inputRef.current?.focus();
  };

  if (!currentUser) {
    return (
      <div className="page">
        <p className="notice">Join the pool to use chat.</p>
      </div>
    );
  }

  return (
    <div className="chat-page">
      <div className="chat-messages" onScroll={handleScroll}>
        {messages.length === 0 && (
          <p className="chat-empty">No messages yet. Start the conversation!</p>
        )}
        {messages.map((msg) => {
          const isMe = msg.user_id === currentUser.user_id;
          return (
            <div key={msg.id} className={`chat-msg ${isMe ? "chat-msg-me" : ""}`}>
              <div className="chat-msg-header">
                <span className="chat-msg-name">{msg.display_name}</span>
                <span className="chat-msg-time">{formatTime(msg.created_at)}</span>
              </div>
              <div className="chat-msg-body">{msg.body.split("\n").map((line, i, arr) => (
                <span key={i}>{line}{i < arr.length - 1 && <br />}</span>
              ))}</div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>
      {chatClosed ? (
        <div className="chat-closed-notice">Chat has been closed by a pool admin.</div>
      ) : (
        <form className="chat-input-bar" onSubmit={handleSend}>
          <div className="chat-input-wrapper" ref={emojiPickerRef}>
            {showEmojiPicker && (
              <div className="emoji-picker">
                {EMOJI_LIST.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    className="emoji-btn"
                    onClick={() => insertEmoji(emoji)}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}
            <button
              type="button"
              className="emoji-toggle"
              onClick={() => setShowEmojiPicker((v) => !v)}
              title="Emoji"
            >
              😀
            </button>
            <textarea
              ref={inputRef}
              className="chat-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.altKey) {
                  e.preventDefault();
                  if (input.trim() && !sending) handleSend(e);
                } else if (e.key === "Enter" && e.altKey) {
                  e.preventDefault();
                  setInput((prev) => prev + "\n");
                }
              }}
              placeholder="Type a message... (Alt+Enter for new line)"
              maxLength={500}
              rows={1}
              autoFocus
            />
          </div>
          <button className="chat-send-btn" type="submit" disabled={sending || !input.trim()}>
            Send
          </button>
        </form>
      )}
    </div>
  );
}

export default Chat;
