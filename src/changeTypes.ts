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
}

export interface ParseIssue extends OffsetRange {
    message: string;
}

export interface ParseResult {
    /** Only changes which have no enclosing change are returned here. */
    changes: LatexChange[];
    issues: ParseIssue[];
}
