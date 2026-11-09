"use client";

import { useState } from "react";
import { FileImage, RefreshCw } from "lucide-react";

type Props = { src: string; alt: string; thumbnail?: boolean };

/** Keep the authorized, same-origin URL; retry never exposes an OSS signature. */
export function DocumentImage(props: Props) {
  return <ImageState key={props.src} {...props} />;
}

function ImageState({ src, alt, thumbnail = false }: Props) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [retry, setRetry] = useState(0);
  const url = retry ? `${src}${src.includes("?") ? "&" : "?"}retry=${retry}` : src;
  return (
    <span className={`document-image${thumbnail ? " document-image--thumbnail" : ""}`}>
      {!failed && <img src={url} alt={alt} loading={thumbnail ? "lazy" : "eager"}
        onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />}
      {!thumbnail && !failed && !loaded && <span className="document-image-loading" role="status">正在加载图片…</span>}
      {failed && (thumbnail ? <span className="document-image-placeholder" aria-label="图片暂未加载"><FileImage size={20} /></span> :
        <span className="document-image-error" role="status">
          <FileImage size={28} /><strong>图片暂未加载成功</strong><span>请检查网络后重试</span>
          <button type="button" className="btn btn--outline btn--small" onClick={() => { setFailed(false); setLoaded(false); setRetry(Date.now()); }}><RefreshCw size={14} />重新加载图片</button>
        </span>)}
    </span>
  );
}
