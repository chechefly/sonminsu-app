import { useState, useRef } from "react";

const NAVER_PROXY = "https://naver-proxy-lac.vercel.app/api";
const ANTHROPIC_KEY = process.env.REACT_APP_ANTHROPIC_KEY;

const X_CHANNELS = [
  { handle: "Kpopidol_closet", label: "아이돌 옷장", category: "패션" },
  { handle: "IDOL_ALLDAY", label: "아이돌 올데이", category: "패션" },
  { handle: "styleupk", label: "스타일업K", category: "패션" },
];

const CATEGORY_PLATFORMS = {
  "상의": "musinsa", "하의": "musinsa", "아우터": "musinsa",
  "신발": "musinsa", "가방": "musinsa", "모자": "musinsa",
  "액세서리": "29cm", "화장품": "oliveyoung", "향수": "oliveyoung",
};

// 네이버 쇼핑 검색
async function searchNaver(keyword) {
  try {
    const res = await fetch(`${NAVER_PROXY}/naver?keyword=${encodeURIComponent(keyword)}`);
    const data = await res.json();
    return (data.items || []).slice(0, 3).map(item => ({
      title: item.title.replace(/<[^>]+>/g, ""),
      price: parseInt(item.lprice),
      link: item.link,
      image: item.image,
      mall: item.mallName,
    }));
  } catch { return []; }
}

// Claude로 텍스트/이미지 분석
async function analyzeWithClaude(input) {
  const isImage = input.startsWith("data:");
  const isUrl = input.startsWith("http");

  const content = isImage
    ? [
        { type: "image", source: { type: "base64", media_type: input.split(";")[0].split(":")[1], data: input.split(",")[1] } },
        { type: "text", text: `이 사진에서 인물의 착장과 뷰티 아이템을 분석해줘. JSON만 반환.
{
  "celebrity": {"name": "이름또는null", "group": "그룹또는null", "content": "예능드라마또는null"},
  "originalImage": null,
  "items": [{"category": "카테고리", "brand": "브랜드", "product": "상품명", "searchKeyword": "네이버쇼핑검색어"}]
}` }
      ]
    : isUrl
    ? `이 URL의 내용에서 K콘텐츠 착장/뷰티 정보를 찾아줘: ${input}
JSON만 반환.
{
  "celebrity": {"name": "이름또는null", "group": "그룹또는null", "content": "예능드라마또는null"},
  "originalImage": "페이지에서찾은인물사진URL또는null",
  "items": [{"category": "카테고리", "brand": "브랜드", "product": "상품명", "searchKeyword": "네이버쇼핑검색어", "directLink": "직접링크있으면URL없으면null"}]
}`
    : `"${input}" 관련 K콘텐츠 착장/뷰티 정보를 알고있는 것 기반으로 알려줘.
JSON만 반환.
{
  "celebrity": {"name": "이름또는null", "group": "그룹또는null", "content": "예능드라마또는null"},
  "originalImage": null,
  "items": [{"category": "카테고리", "brand": "브랜드", "product": "상품명", "searchKeyword": "네이버쇼핑검색어"}]
}`;

const response = await fetch("https://naver-proxy-lac.vercel.app/api/claude", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      tools: isUrl ? [{ type: "web_search_20250305", name: "web_search" }] : undefined,
      messages: [{ role: "user", content }],
    }),
  });

  const data = await res.json();
  const text = data.content?.filter(b => b.type === "text").map(b => b.text).join("") || "";
  try {
    return JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch { return null; }
}

export default function App() {
  const [tab, setTab] = useState("sourcing");
  const [urlInput, setUrlInput] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState("");
  const [result, setResult] = useState(null);
  const [saved, setSaved] = useState([]);
  const [channels, setChannels] = useState(X_CHANNELS);
  const [newChannel, setNewChannel] = useState("");
  const fileRef = useRef();

  const process = async (input, type) => {
    setLoading(true);
    setResult(null);

    try {
      setLoadingStep("AI 분석 중...");
      const analysis = await analyzeWithClaude(input);
      if (!analysis) throw new Error("분석 실패");

      setLoadingStep("쇼핑 링크 검색 중...");
      const itemsWithLinks = await Promise.all(
        (analysis.items || []).map(async (item, i) => {
          await new Promise(r => setTimeout(r, i * 300));
          const shopItems = item.directLink
            ? [{ title: item.product, price: null, link: item.directLink, image: null, mall: "직접링크" }]
            : await searchNaver(item.searchKeyword || `${item.brand} ${item.product}`);

          return {
            id: `item_${Date.now()}_${i}`,
            category: item.category,
            brand: item.brand,
            product: item.product,
            shopItems,
            selectedShop: shopItems[0] || null,
            platform: CATEGORY_PLATFORMS[item.category] || "naver",
            affiliateLink: null,
          };
        })
      );

      const post = {
        id: `post_${Date.now()}`,
        createdAt: new Date().toISOString(),
        source: {
          type,
          platform: type === "url" ? "url" : type === "image" ? "upload" : "search",
          url: type === "url" ? input : null,
          originalImage: analysis.originalImage || (type === "image" ? input : null),
        },
        celebrity: analysis.celebrity || { name: null, group: null, content: null },
        items: itemsWithLinks,
        content: { status: "saved", cardNews: null, publishedAt: null, platform: null },
      };

      setResult(post);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => process(ev.target.result, "image");
    reader.readAsDataURL(file);
  };

  const saveResult = () => {
    if (!result) return;
    setSaved(prev => [result, ...prev.filter(p => p.id !== result.id)]);
    alert("저장됐어요!");
  };

  const selectShop = (itemId, shopItem) => {
    setResult(prev => ({
      ...prev,
      items: prev.items.map(item =>
        item.id === itemId ? { ...item, selectedShop: shopItem } : item
      ),
    }));
  };

  return (
    <div style={{ minHeight: "100vh", background: "#0C0C0C", color: "#F0EBE3", fontFamily: "Georgia, serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@300;400;600&family=DM+Mono:wght@300;400&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
        @keyframes pulse { 0%,100%{opacity:.4} 50%{opacity:1} }
        .fu { animation: fadeUp .3s ease both; }
        input, textarea { outline: none; }
        input:focus { border-color: #F0EBE3 !important; }
        ::-webkit-scrollbar { width: 3px; }
        ::-webkit-scrollbar-thumb { background: #2A2A2A; }
        .shop-opt:hover { background: #1A1A1A !important; }
        .shop-opt { transition: background .15s; cursor: pointer; }
      `}</style>

      {/* Header */}
      <header style={{
        padding: "16px 28px", borderBottom: "1px solid #1A1A1A",
        display: "flex", justifyContent: "space-between", alignItems: "center",
        position: "sticky", top: 0, background: "rgba(12,12,12,0.96)",
        backdropFilter: "blur(20px)", zIndex: 100,
      }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span style={{ fontFamily: "'Noto Serif KR'", fontSize: 16, fontWeight: 600 }}>손민수</span>
          <span style={{ fontFamily: "'DM Mono'", fontSize: 9, color: "#333", letterSpacing: ".15em" }}>K-FASHION AFFILIATE</span>
        </div>
        <nav style={{ display: "flex", gap: 24 }}>
          {[
            { id: "sourcing", label: "소싱" },
            { id: "channels", label: `채널 (${channels.length})` },
            { id: "saved", label: `저장됨 (${saved.length})` },
          ].map(n => (
            <span key={n.id} onClick={() => setTab(n.id)} style={{
              fontFamily: "'DM Mono'", fontSize: 10, cursor: "pointer",
              color: tab === n.id ? "#F0EBE3" : "#444",
              letterSpacing: ".1em", textTransform: "uppercase",
              transition: "color .15s",
            }}>{n.label}</span>
          ))}
        </nav>
      </header>

      <main style={{ maxWidth: 820, margin: "0 auto", padding: "28px 20px" }}>

        {/* ── 소싱 탭 ── */}
        {tab === "sourcing" && (
          <div className="fu">
            {/* 입력 3가지 */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 1, marginBottom: 28, border: "1px solid #1A1A1A" }}>
              {/* URL */}
              <div style={{ padding: "20px 18px", background: "#0F0F0F", borderRight: "1px solid #1A1A1A" }}>
                <div style={{ fontFamily: "'DM Mono'", fontSize: 9, color: "#444", letterSpacing: ".12em", marginBottom: 10, textTransform: "uppercase" }}>URL 입력</div>
                <input
                  value={urlInput}
                  onChange={e => setUrlInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && process(urlInput, "url")}
                  placeholder="블로그, 트위터, 인스타 URL"
                  style={{
                    width: "100%", background: "#161616", border: "1px solid #1A1A1A",
                    color: "#F0EBE3", padding: "8px 10px",
                    fontFamily: "'DM Mono'", fontSize: 10, marginBottom: 8,
                  }}
                />
                <button onClick={() => process(urlInput, "url")} disabled={!urlInput || loading} style={{
                  width: "100%", background: urlInput && !loading ? "#F0EBE3" : "#1A1A1A",
                  color: urlInput && !loading ? "#0C0C0C" : "#333",
                  border: "none", padding: "8px", fontFamily: "'DM Mono'",
                  fontSize: 9, letterSpacing: ".1em", cursor: urlInput ? "pointer" : "default",
                }}>분석하기</button>
              </div>

              {/* 사진 업로드 */}
              <div style={{ padding: "20px 18px", background: "#0F0F0F", borderRight: "1px solid #1A1A1A" }}>
                <div style={{ fontFamily: "'DM Mono'", fontSize: 9, color: "#444", letterSpacing: ".12em", marginBottom: 10, textTransform: "uppercase" }}>사진 업로드</div>
                <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleFile} />
                <div
                  onClick={() => !loading && fileRef.current.click()}
                  style={{
                    border: "1px dashed #1A1A1A", padding: "24px 10px",
                    textAlign: "center", cursor: "pointer",
                    fontFamily: "'DM Mono'", fontSize: 10, color: "#333",
                  }}
                >
                  클릭해서 업로드
                  <br />
                  <span style={{ fontSize: 8, color: "#2A2A2A" }}>JPG · PNG · WEBP</span>
                </div>
              </div>

              {/* 검색 */}
              <div style={{ padding: "20px 18px", background: "#0F0F0F" }}>
                <div style={{ fontFamily: "'DM Mono'", fontSize: 9, color: "#444", letterSpacing: ".12em", marginBottom: 10, textTransform: "uppercase" }}>검색어</div>
                <input
                  value={searchInput}
                  onChange={e => setSearchInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && process(searchInput, "search")}
                  placeholder="슬기, 솔로지옥, 카리나..."
                  style={{
                    width: "100%", background: "#161616", border: "1px solid #1A1A1A",
                    color: "#F0EBE3", padding: "8px 10px",
                    fontFamily: "'DM Mono'", fontSize: 10, marginBottom: 8,
                  }}
                />
                <button onClick={() => process(searchInput, "search")} disabled={!searchInput || loading} style={{
                  width: "100%", background: searchInput && !loading ? "#F0EBE3" : "#1A1A1A",
                  color: searchInput && !loading ? "#0C0C0C" : "#333",
                  border: "none", padding: "8px", fontFamily: "'DM Mono'",
                  fontSize: 9, letterSpacing: ".1em", cursor: searchInput ? "pointer" : "default",
                }}>검색하기</button>
              </div>
            </div>

            {/* 로딩 */}
            {loading && (
              <div style={{ textAlign: "center", padding: "60px 0" }}>
                <div style={{
                  width: 28, height: 28, border: "1px solid #2A2A2A",
                  borderTopColor: "#F0EBE3", borderRadius: "50%",
                  margin: "0 auto 16px", animation: "spin .7s linear infinite",
                }} />
                <p style={{ fontFamily: "'DM Mono'", fontSize: 10, color: "#444", animation: "pulse 1.5s ease infinite" }}>
                  {loadingStep}
                </p>
              </div>
            )}

            {/* 결과 */}
            {!loading && result && (
              <div className="fu">
                {/* 인물 정보 + 원본 이미지 */}
                <div style={{
                  display: "grid",
                  gridTemplateColumns: result.source.originalImage ? "160px 1fr" : "1fr",
                  gap: 20, marginBottom: 20,
                  background: "#0F0F0F", border: "1px solid #1A1A1A", padding: 20,
                }}>
                  {result.source.originalImage && (
                    <img src={result.source.originalImage} alt="원본" style={{
                      width: "100%", aspectRatio: "3/4", objectFit: "cover",
                    }} onError={e => e.target.style.display = "none"} />
                  )}
                  <div>
                    <div style={{ fontFamily: "'DM Mono'", fontSize: 8, color: "#333", letterSpacing: ".15em", marginBottom: 8 }}>
                      RESULT
                    </div>
                    <h2 style={{ fontFamily: "'Noto Serif KR'", fontSize: 20, fontWeight: 400, marginBottom: 4 }}>
                      {result.celebrity.name || "알 수 없음"}
                    </h2>
                    {result.celebrity.group && (
                      <span style={{ fontFamily: "'DM Mono'", fontSize: 10, color: "#555", marginRight: 8 }}>
                        {result.celebrity.group}
                      </span>
                    )}
                    {result.celebrity.content && (
                      <span style={{ fontFamily: "'DM Mono'", fontSize: 10, color: "#555" }}>
                        {result.celebrity.content}
                      </span>
                    )}
                    <div style={{ marginTop: 12, fontFamily: "'DM Mono'", fontSize: 9, color: "#333" }}>
                      {result.items.length}개 아이템 발견
                    </div>
                    <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {result.items.map(item => (
                        <span key={item.id} style={{
                          fontFamily: "'DM Mono'", fontSize: 8,
                          border: "1px solid #2A2A2A", padding: "2px 8px", color: "#666",
                        }}>{item.category}</span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* 아이템별 쇼핑 결과 */}
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
                  {result.items.map(item => (
                    <div key={item.id} style={{
                      background: "#0F0F0F", border: "1px solid #1A1A1A", padding: "16px 18px",
                    }}>
                      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 10 }}>
                        <span style={{
                          fontFamily: "'DM Mono'", fontSize: 8, color: "#888",
                          border: "1px solid #2A2A2A", padding: "1px 7px",
                        }}>{item.category}</span>
                        <span style={{ fontFamily: "'Noto Serif KR'", fontSize: 13, color: "#F0EBE3" }}>
                          {item.brand} {item.product}
                        </span>
                      </div>

                      {/* 쇼핑 옵션 */}
                      {item.shopItems.length > 0 ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          {item.shopItems.map((shop, si) => (
                            <div key={si} className="shop-opt" onClick={() => selectShop(item.id, shop)} style={{
                              display: "flex", gap: 12, alignItems: "center",
                              padding: "10px 12px",
                              background: item.selectedShop?.link === shop.link ? "#161616" : "transparent",
                              border: `1px solid ${item.selectedShop?.link === shop.link ? "#333" : "#161616"}`,
                            }}>
                              {shop.image && (
                                <img src={shop.image} alt="" style={{
                                  width: 44, height: 44, objectFit: "cover", flexShrink: 0,
                                }} onError={e => e.target.style.display = "none"} />
                              )}
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{
                                  fontFamily: "'Noto Serif KR'", fontSize: 11, color: "#CCC",
                                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                  marginBottom: 3,
                                }}>{shop.title}</div>
                                <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                                  {shop.price && (
                                    <span style={{ fontFamily: "'DM Mono'", fontSize: 12, color: "#F0EBE3" }}>
                                      ₩{shop.price.toLocaleString()}
                                    </span>
                                  )}
                                  <span style={{ fontFamily: "'DM Mono'", fontSize: 9, color: "#444" }}>
                                    {shop.mall}
                                  </span>
                                </div>
                              </div>
                              <a href={shop.link} target="_blank" rel="noreferrer"
                                onClick={e => e.stopPropagation()}
                                style={{
                                  fontFamily: "'DM Mono'", fontSize: 9, color: "#555",
                                  border: "1px solid #2A2A2A", padding: "5px 10px",
                                  textDecoration: "none", flexShrink: 0,
                                }}>
                                구매 →
                              </a>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div style={{ fontFamily: "'DM Mono'", fontSize: 10, color: "#333", padding: "10px 0" }}>
                          상품을 찾지 못했어요
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* 저장 버튼 */}
                <button onClick={saveResult} style={{
                  width: "100%", background: "#F0EBE3", color: "#0C0C0C",
                  border: "none", padding: "14px",
                  fontFamily: "'DM Mono'", fontSize: 11,
                  letterSpacing: ".1em", cursor: "pointer",
                }}>
                  저장하기 →
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── 채널 탭 ── */}
        {tab === "channels" && (
          <div className="fu">
            <div style={{ fontFamily: "'DM Mono'", fontSize: 9, color: "#333", letterSpacing: ".15em", marginBottom: 20, textTransform: "uppercase" }}>
              X 채널 관리
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
              <input
                value={newChannel}
                onChange={e => setNewChannel(e.target.value)}
                placeholder="@채널명 입력"
                style={{
                  flex: 1, background: "#0F0F0F", border: "1px solid #1A1A1A",
                  color: "#F0EBE3", padding: "10px 14px",
                  fontFamily: "'DM Mono'", fontSize: 11,
                }}
              />
              <button onClick={() => {
                if (!newChannel) return;
                const handle = newChannel.replace("@", "");
                setChannels(prev => [...prev, { handle, label: handle, category: "패션" }]);
                setNewChannel("");
              }} style={{
                background: "#F0EBE3", color: "#0C0C0C", border: "none",
                padding: "10px 20px", fontFamily: "'DM Mono'",
                fontSize: 10, cursor: "pointer",
              }}>+ 추가</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {channels.map((ch, i) => (
                <div key={i} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  background: "#0F0F0F", border: "1px solid #1A1A1A", padding: "14px 16px",
                }}>
                  <div>
                    <span style={{ fontFamily: "'DM Mono'", fontSize: 12, color: "#F0EBE3" }}>@{ch.handle}</span>
                    <span style={{ fontFamily: "'DM Mono'", fontSize: 9, color: "#444", marginLeft: 12 }}>{ch.category}</span>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <a href={`https://x.com/${ch.handle}`} target="_blank" rel="noreferrer" style={{
                      fontFamily: "'DM Mono'", fontSize: 9, color: "#555",
                      border: "1px solid #2A2A2A", padding: "4px 10px",
                      textDecoration: "none",
                    }}>X에서 보기</a>
                    <button onClick={() => setChannels(prev => prev.filter((_, j) => j !== i))} style={{
                      background: "transparent", border: "1px solid #1A1A1A",
                      color: "#333", padding: "4px 10px",
                      fontFamily: "'DM Mono'", fontSize: 9, cursor: "pointer",
                    }}>삭제</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── 저장됨 탭 ── */}
        {tab === "saved" && (
          <div className="fu">
            <div style={{ fontFamily: "'DM Mono'", fontSize: 9, color: "#333", letterSpacing: ".15em", marginBottom: 20, textTransform: "uppercase" }}>
              저장된 포스트 {saved.length}개
            </div>
            {saved.length === 0 ? (
              <div style={{ textAlign: "center", padding: "80px 0" }}>
                <p style={{ fontFamily: "'Noto Serif KR'", fontSize: 16, color: "#2A2A2A", fontWeight: 300 }}>
                  아직 저장된 항목이 없어요
                </p>
                <button onClick={() => setTab("sourcing")} style={{
                  marginTop: 16, background: "transparent",
                  border: "1px solid #1A1A1A", color: "#444",
                  padding: "10px 20px", fontFamily: "'DM Mono'",
                  fontSize: 9, cursor: "pointer", letterSpacing: ".1em",
                }}>소싱하러 가기</button>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {saved.map((post, i) => (
                  <div key={i} style={{
                    background: "#0F0F0F", border: "1px solid #1A1A1A", padding: "16px 18px",
                    display: "grid", gridTemplateColumns: post.source.originalImage ? "80px 1fr" : "1fr",
                    gap: 16,
                  }}>
                    {post.source.originalImage && (
                      <img src={post.source.originalImage} alt="" style={{
                        width: "100%", aspectRatio: "3/4", objectFit: "cover",
                      }} onError={e => e.target.style.display = "none"} />
                    )}
                    <div>
                      <div style={{ fontFamily: "'Noto Serif KR'", fontSize: 15, fontWeight: 400, marginBottom: 6 }}>
                        {post.celebrity.name || "알 수 없음"}
                        {post.celebrity.group && <span style={{ fontFamily: "'DM Mono'", fontSize: 10, color: "#555", marginLeft: 8 }}>{post.celebrity.group}</span>}
                      </div>
                      <div style={{ fontFamily: "'DM Mono'", fontSize: 9, color: "#444", marginBottom: 10 }}>
                        {new Date(post.createdAt).toLocaleDateString("ko-KR")} · 아이템 {post.items.length}개
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                        {post.items.map(item => (
                          <div key={item.id} style={{
                            fontFamily: "'DM Mono'", fontSize: 8,
                            border: "1px solid #2A2A2A", padding: "2px 8px", color: "#666",
                          }}>
                            {item.category} · {item.brand}
                            {item.selectedShop && (
                              <span style={{ color: "#03C75A", marginLeft: 4 }}>
                                ₩{item.selectedShop.price?.toLocaleString()}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
