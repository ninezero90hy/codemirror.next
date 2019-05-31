import {TagMap, TreeContext, TERM_ERR} from "lezer"
import {LezerSyntax} from "../../syntax/src/syntax"
import {EditorState, StateExtension} from "../../state/src/"

// FIXME handle nested syntaxes

export function syntaxIndentation(syntax: LezerSyntax, strategies: TagMap<IndentStrategy>) {
  return StateExtension.indentation((state, pos) => {
    let inner = new IndentContextInner(pos, strategies, syntax, state)
    let cx: TreeContext | null = syntax.getTree(state, pos, pos).resolve(pos)
    if (cx.end == pos) for (let scan = cx!;;) {
      let last = scan.childBefore(scan.end + 1)
      if (!last || last.end < scan.end) break
      if (last.type == TERM_ERR) cx = scan
      scan = last
    }
    for (; cx; cx = cx.parent) {
      let strategy = strategies.get(cx.type) || (cx.parent == null ? topStrategy : null)
      if (strategy) {
        let indentContext = new IndentContext(inner, cx, strategy)
        return indentContext.getIndent()
      }
    }
    return -1
  })
}

export class IndentContextInner {
  constructor(readonly pos: number,
              readonly strategies: TagMap<IndentStrategy>,
              readonly syntax: LezerSyntax,
              readonly state: EditorState) {}
}

export class IndentContext {
  constructor(private inner: IndentContextInner,
              readonly context: TreeContext,
              readonly strategy: IndentStrategy) {}

  get syntax() { return this.inner.syntax }
  get state() { return this.inner.state }
  get pos() { return this.inner.pos }

  get next() {
    let last = this.context, found = null
    for (let cx = this.context.parent; !found && cx; cx = cx.parent) {
      found = this.inner.strategies.get(cx.type)
      last = cx
    }
    return new IndentContext(this.inner, last, found || topStrategy)
  }

  get textAfter() {
    return this.state.doc.slice(this.pos, Math.min(this.pos + 50, this.state.doc.lineAt(this.pos).end)).match(/^\s*(.*)/)![1]
  }

  getIndent() { return this.strategy.getIndent(this) }

  baseIndent() {
    let f = this.strategy.baseIndent
    return f ? f(this) : -1
  }

  get startLine() {
    return this.state.doc.lineAt(this.context.start)
  }

  get textBefore() {
    let line = this.startLine
    return line.slice(0, this.context.start - line.start)
  }

  countColumn(line: string, pos: number) {
    if (pos < 0) pos = line.length
    let tab = this.state.tabSize
    for (var i = 0, n = 0;;) {
      let nextTab = line.indexOf("\t", i);
      if (nextTab < 0 || nextTab >= pos) return n + (pos - i)
      n += nextTab - i
      n += tab - (n % tab)
      i = nextTab + 1
    }
  }

  get lineIndent() {
    let line = this.textBefore
    return this.countColumn(line, line.search(/\S/))
  }

  get nodeColumn() {
    return this.countColumn(this.textBefore, -1)
  }
}

export interface IndentStrategy {
  getIndent: (context: IndentContext) => number
  baseIndent?: (context: IndentContext) => number
}

export const topStrategy: IndentStrategy = {
  getIndent() { return 0 },
  baseIndent() { return 0 }
}

const UNIT = 2 // FIXME make configurable somehow

// FIXME alignment
export function bracketed(closing: string): IndentStrategy {
  return {
    getIndent(context: IndentContext) {
      let closed = context.textAfter.slice(0, closing.length) == closing
      return context.next.baseIndent() + (closed ? 0 : UNIT)
    },
    baseIndent(context: IndentContext) {
      let {next} = context
      return next.baseIndent() + (next.startLine.start == context.startLine.start ? 0 : UNIT)
    }
  }
}

export const parens = bracketed(")"), braces = bracketed("}"), brackets = bracketed("]")

export const statement: IndentStrategy = {
  getIndent(context: IndentContext) {
    return context.baseIndent() + UNIT // FIXME configurable statement indent?
  },
  baseIndent(context: IndentContext) {
    return context.lineIndent
  }
}

export const dontIndent: IndentStrategy = {
  getIndent() { return -1 }
}
