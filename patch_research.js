const fs = require('fs');
const file = 'frontend/app/(dashboard)/research/page.tsx';
let content = fs.readFileSync(file, 'utf8');

// 1. Add states
const stateAddition = `
  const [sessionIds, setSessionIds] = useState<Record<string, string>>({});
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [pendingDocId, setPendingDocId] = useState<string | null>(null);

  // Load session from URL
  useEffect(() => {
    const loadSessionFromUrl = async () => {
      if (typeof window === 'undefined') return;
      const params = new URLSearchParams(window.location.search);
      const sessionId = params.get('session');
      if (!sessionId) return;
      
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token || '';

        const res = await fetch(\`http://localhost:4000/api/sessions/\${sessionId}\`, {
          headers: { 'Authorization': \`Bearer \${token}\` }
        });
        if (res.ok) {
          const sessionData = await res.json();
          if (sessionData.document_id) {
            setActiveSessionId(sessionId);
            setSessionIds(prev => ({ ...prev, [sessionData.document_id]: sessionId }));
            setPendingDocId(sessionData.document_id);
            
            // fetch messages
            const msgRes = await fetch(\`http://localhost:4000/api/sessions/\${sessionId}/messages\`, {
              headers: { 'Authorization': \`Bearer \${token}\` }
            });
            if (msgRes.ok) {
              const messages = await msgRes.json();
              if (messages.length > 0) {
                 setChats(prev => ({ ...prev, [sessionData.document_id]: messages.map((m: any) => ({
                    id: m.id,
                    role: m.role,
                    content: m.content
                 }))}));
              }
            }
          }
        }
      } catch (err) {
        console.error("Failed to load session:", err);
      }
    };
    loadSessionFromUrl();
  }, []);

  useEffect(() => {
    if (documents.length > 0 && pendingDocId) {
      const doc = documents.find(d => d.id === pendingDocId);
      if (doc) {
        setActiveDocument(doc);
        setPendingDocId(null);
      }
    }
  }, [documents, pendingDocId]);
`;

content = content.replace(
  '  const defaultMessages = [',
  stateAddition + '\n  const defaultMessages = ['
);


// 2. Change onClick
const onClickReplacement = `onClick={() => {
                  setActiveDocument(doc);
                  setActiveSessionId(sessionIds[doc.id] || null);
                  if (typeof window !== 'undefined') {
                    window.history.replaceState({}, '', '/research');
                  }
                }}`;
content = content.replace('onClick={() => setActiveDocument(doc)}', onClickReplacement);


// 3. Update handleSend
const handleSendOriginal = `    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';

      const res = await fetch("http://localhost:4000/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: \`Bearer \${token}\`,
        },
        body: JSON.stringify({
          query: userText,
          session_id: "doc-chat",
          document_id: activeDocument?.id || undefined,
          history: messages.map(m => ({ role: m.role, content: m.content })),
        }),
      });`;

const handleSendReplacement = `    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';

      let currentSessionId = activeSessionId;
      if (!currentSessionId && activeDocument) {
        const createRes = await fetch("http://localhost:4000/api/sessions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": \`Bearer \${token}\`
          },
          body: JSON.stringify({
            title: \`Analysis: \${activeDocument.filename}\`,
            session_type: 'document_analysis',
            document_id: activeDocument.id
          })
        });
        if (createRes.ok) {
          const newSession = await createRes.json();
          currentSessionId = newSession.id;
          setActiveSessionId(currentSessionId);
          setSessionIds(prev => ({ ...prev, [activeDocument.id]: currentSessionId }));
          window.history.replaceState({}, '', \`/research?session=\${currentSessionId}\`);
        }
      }

      const res = await fetch("http://localhost:4000/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: \`Bearer \${token}\`,
        },
        body: JSON.stringify({
          query: userText,
          session_id: currentSessionId || "doc-chat",
          document_id: activeDocument?.id || undefined,
          history: messages.map(m => ({ role: m.role, content: m.content })),
        }),
      });`;

content = content.replace(handleSendOriginal, handleSendReplacement);

fs.writeFileSync(file, content);
console.log("Successfully patched page.tsx");
