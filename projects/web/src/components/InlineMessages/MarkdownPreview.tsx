import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"

const MARKDOWN_PATTERN = /(^#{1,6} )|```|(\*\*[^*]+\*\*)|(^\s*[-*+] )|(^\s*\d+\. )|(\|.*\|)|(^>\s)/m

export function hasMarkdown(text: string): boolean {
    return MARKDOWN_PATTERN.test(text)
}

const COMPONENTS: Components = {
    code({ className, children, ...rest }) {
        const isInline = !className?.startsWith("language-")
        if (isInline) {
            return (
                <code className="px-1 py-0.5 bg-base-200 font-mono text-xs" {...rest}>
                    {children}
                </code>
            )
        }
        return (
            <code className={`${className ?? ""} font-mono text-xs`} {...rest}>
                {children}
            </code>
        )
    },
    pre({ children }) {
        return <pre className="bg-base-200 border border-border p-2 overflow-x-auto my-2 text-xs">{children}</pre>
    },
    a({ href, children }) {
        return (
            <a href={href} target="_blank" rel="noreferrer" className="text-info underline">
                {children}
            </a>
        )
    },
}

export function MarkdownPreview({ text }: { text: string }) {
    return (
        <div className="prose-openade px-3 py-2 text-sm">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
                {text}
            </ReactMarkdown>
        </div>
    )
}
