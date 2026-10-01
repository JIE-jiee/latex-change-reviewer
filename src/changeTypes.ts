export interface OffsetRange {
    start: number;
    end: number;
}

export type ChangeType = 'added' | 'deleted' | 'replaced';
export type ReviewDecision = 'accept' | 'reject';

/** Argument ranges exclude their surrounding braces; end offsets are exclusive. */
export interface LatexChange extends OffsetRange {
    type: ChangeType;
    args: OffsetRange[];
    children: LatexChange[];
    /** Malformed nested changes make reviewing the parent unsafe. */
    blocked?: boolean;
    optionalRange?: OffsetRange;
    authorId?: string;
    comment?: LatexComment;
}

export interface LatexComment extends OffsetRange {
    kind: 'attached' | 'highlight' | 'standalone';
    contentRange: OffsetRange;
    anchorRange: OffsetRange;
    optionalRange?: OffsetRange;
    /** Owner is intentionally omitted by the parser to avoid cyclic object graphs. */
    owner?: LatexChange;
}

export interface ParseIssue extends OffsetRange {
    message: string;
}

export interface ParseResult {
    /** Only changes which have no enclosing change are returned here. */
    changes: LatexChange[];
    issues: ParseIssue[];
    /** All comments in source order, including comments nested in changes. */
    comments: LatexComment[];
}
