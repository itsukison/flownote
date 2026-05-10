import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

type MarkdownRendererProps = {
    content: string
    className?: string
}

export default function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
    return (
        <div className={className}>
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                    p: ({ children }) => (
                        <p className="mb-2 last:mb-0">
                            {children}
                        </p>
                    ),
                    strong: ({ children }) => (
                        <strong className="font-semibold text-current">
                            {children}
                        </strong>
                    ),
                    em: ({ children }) => (
                        <em className="italic text-current">
                            {children}
                        </em>
                    ),
                    ul: ({ children }) => (
                        <ul className="list-disc pl-4 mb-2 last:mb-0">
                            {children}
                        </ul>
                    ),
                    ol: ({ children }) => (
                        <ol className="list-decimal pl-4 mb-2 last:mb-0">
                            {children}
                        </ol>
                    ),
                    li: ({ children }) => (
                        <li className="mb-1 last:mb-0">
                            {children}
                        </li>
                    ),
                    code: ({ children, ...props }) => {
                        const inline = (props as { inline?: boolean }).inline
                        return inline ? (
                            <code className="px-1 py-0.5 rounded bg-zinc-800/70 text-current text-[0.85em]">
                                {children}
                            </code>
                        ) : (
                            <pre className="p-2 rounded bg-zinc-900/70 text-current text-[0.85em] overflow-x-auto">
                                <code className="text-current">{children}</code>
                            </pre>
                        )
                    },
                }}
            >
                {content}
            </ReactMarkdown>
        </div>
    )
}
