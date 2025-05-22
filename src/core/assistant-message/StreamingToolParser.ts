import { EventEmitter } from "events"
import { TextContent, ToolUse, ToolParamName } from "../../shared/tools"
import { ToolName } from "../../schemas"

type AssistantMessageContent = TextContent | ToolUse

/**
 * Defines the structure and rules for a tag node in the schema.
 */
export interface NodeSchema {
	/** The name of the tag (e.g., "apply_diff", "path"). */
	name: string
	/** If true, this tag can directly contain text content. */
	allowedTextContent: boolean
	/** An array of schemas defining allowed child tags. If undefined/empty, no child tags are allowed. */
	children?: NodeSchema[]
	/** A reference to the parent node in the schema. This is useful for traversing back up the schema tree. */
	parent?: NodeSchema
}

interface StreamingToolParserOptions {
	validToolNames: Set<ToolName>
	validParamNamesByTool: Map<ToolName, Set<ToolParamName>>
	relaxedMode?: boolean
}

// Represents the different states the parser can be in
enum ParseStateEnum {
	Text = "text",
	TagOpening = "tag_opening",
	TagName = "tag_name",
	TextContent = "text_content",
	ClosingTag = "closing_tag",
}

// ParserContext class to hold all shared parsing state
class ParserContext {
	// Buffers
	public textBuffer: string = ""
	public tagBuffer: string = ""
	public paramValueBuffer: string = ""
	public closingTagBuffer: string = ""

	public currentNode: NodeSchema
	public rootNode: NodeSchema

	// Current Parsing Objects
	public currentToolUse: ToolUse | null = null
	public currentParamName: ToolParamName | null = null

	// Configuration
	public readonly fenceStart: string = "<"
	public readonly fenceStop: string = ">"
	public readonly relaxedMode: boolean

	constructor(
		private readonly parser: StreamingToolParser,
		readonly options: StreamingToolParserOptions,
	) {
		this.rootNode = {
			name: "root",
			allowedTextContent: true,
		}
		this.rootNode.children = this.buildSchemaFromValidTools(options.validToolNames, options.validParamNamesByTool)
		this.currentNode = this.rootNode
		this.relaxedMode = !!options.relaxedMode
	}

	// Simplified schema building method for now until tools get more complex
	buildSchemaFromValidTools(
		validToolNames: Set<ToolName>,
		validParamNamesByTool: Map<ToolName, Set<ToolParamName>>,
	): NodeSchema[] {
		const schema: NodeSchema[] = []

		for (const toolName of validToolNames) {
			const toolNode: NodeSchema = {
				name: toolName,
				allowedTextContent: false,
				children: [],
				parent: this.rootNode,
			}

			const params = validParamNamesByTool.get(toolName)
			if (params) {
				toolNode.children = Array.from(params).map((param) => ({
					name: param,
					allowedTextContent: true,
					parent: toolNode,
				}))
			}

			schema.push(toolNode)
		}

		return schema
	}

	// Helper Methods
	/**
	 * Finds a child schema with the given tag name within the current node's children
	 */
	findChildSchema(tagName: string): NodeSchema | undefined {
		return this.currentNode.children?.find((child) => child.name === tagName)
	}

	/**
	 * Checks if any child schema in the current node has the given prefix
	 */
	hasChildSchemaWithPrefix(prefix: string): boolean {
		return !!this.currentNode.children?.some((child) => child.name.startsWith(prefix))
	}

	/**
	 * Returns whether the current node allows text content
	 */
	canContainText(): boolean {
		return this.currentNode.allowedTextContent
	}

	/**
	 * Emits a block of content via the parser's event emitter.
	 * @param block - The text or tool use content to emit
	 */
	emitBlock(block: AssistantMessageContent): void {
		this.parser.emit("block", block)
	}

	/**
	 * Emits an error event via the parser's event emitter.
	 * @param message - The error message to emit
	 */
	emitError(message: string): void {
		this.parser.emit("error", new Error(message))
	}

	/**
	 * Resets the state related to the current parameter.
	 * Clears the currentParamName and associated buffers.
	 */
	resetParamState(): void {
		this.currentParamName = null
		this.paramValueBuffer = ""
	}

	/**
	 * Resets the entire tool state.
	 * Clears the currentToolUse and all associated parameter data and buffers.
	 */
	resetToolState(): void {
		this.currentToolUse = null
		this.resetParamState()
		this.tagBuffer = ""
		this.closingTagBuffer = ""
	}

	/**
	 * Stores the current parameter value in the currentToolUse object.
	 */
	storeCurrentParamValue(): void {
		if (this.currentToolUse && this.currentParamName) {
			if (!this.currentToolUse.params) {
				this.currentToolUse.params = {}
			}
			this.currentToolUse.params[this.currentParamName] = this.paramValueBuffer
		}
	}
}

// ParserState interface for all states
interface ParserState {
	processChar(context: ParserContext, char: string): ParserState
	getStateType(): ParseStateEnum
}

// State singletons
let textState: TextState
let tagOpeningState: TagOpeningState
let tagNameState: TagNameState
let textContentState: TextContentState
let closingTagState: ClosingTagState

// Main parser class
export class StreamingToolParser extends EventEmitter {
	private readonly context: ParserContext
	private currentState: ParserState

	constructor(options: StreamingToolParserOptions) {
		super()
		this.context = new ParserContext(this, options)

		// Initialize state singletons
		textState = new TextState()
		tagOpeningState = new TagOpeningState()
		tagNameState = new TagNameState()
		textContentState = new TextContentState()
		closingTagState = new ClosingTagState()

		// Start in text state
		this.currentState = textState
	}

	public processChunk(chunk: string): void {
		for (const char of chunk) {
			this.currentState = this.currentState.processChar(this.context, char)
		}
		this.emitPartialAtChunkEnd()
	}

	public finalize(): void {
		const finalStateType = this.currentState.getStateType()

		// Emit final text if stream ends in Text state
		if (finalStateType === ParseStateEnum.Text && this.context.textBuffer) {
			const normalizedText = this.context.textBuffer.trim()
			if (normalizedText) {
				this.context.emitBlock({ type: "text", content: normalizedText, partial: false })
				this.context.textBuffer = ""
			}
		}

		// Reset parser state
		this.context.resetToolState()
		this.context.textBuffer = ""
		this.currentState = textState
		this.context.currentNode = this.context.rootNode
	}

	private emitPartialAtChunkEnd(): void {
		const currentStateType = this.currentState.getStateType()

		if (currentStateType === ParseStateEnum.Text && this.context.textBuffer) {
			const normalizedText = this.context.textBuffer.trim()
			if (normalizedText) {
				this.context.emitBlock({ type: "text", content: normalizedText, partial: true })
			}
		}
		// Emit partial tool blocks for any active tool state
		else if (this.context.currentToolUse) {
			// If we're in a parameter value state, store the current value
			if (currentStateType === ParseStateEnum.TextContent && this.context.currentNode !== this.context.rootNode) {
				this.context.storeCurrentParamValue()
			}

			// Create a deep copy of the params to prevent reference mutation
			const params = this.context.currentToolUse.params ? { ...this.context.currentToolUse.params } : {}

			// Emit the current tool state as partial with copied params
			this.context.emitBlock({
				type: "tool_use",
				name: this.context.currentToolUse.name,
				params,
				partial: true,
			})
		}
	}
}

// Text state - default state, looking for opening '<'
class TextState implements ParserState {
	getStateType(): ParseStateEnum {
		return ParseStateEnum.Text
	}

	processChar(context: ParserContext, char: string): ParserState {
		if (char === "<") {
			if (context.textBuffer) {
				const normalizedText = context.textBuffer.trim()
				if (normalizedText) {
					context.emitBlock({ type: "text", content: normalizedText, partial: false })
					context.textBuffer = ""
				}
			}
			context.tagBuffer = ""
			return tagOpeningState
		} else if (!context.currentNode.allowedTextContent) {
			// Ignore and consume whitespaces when no text content is allowed, if not handle potential error
			if (!/\s/.test(char)) {
				context.emitError(`Unexpected character "${char}" outside of allowed text content`)
				context.textBuffer += char
			}
		} else {
			context.textBuffer += char
		}
		return this
	}
}

// TagOpening state - after seeing '<', determine if it's a tag opening or closing
class TagOpeningState implements ParserState {
	getStateType(): ParseStateEnum {
		return ParseStateEnum.TagOpening
	}

	processChar(context: ParserContext, char: string): ParserState {
		if (char === "/") {
			// It's a closing tag
			// Check if we have a current node to close
			if (context.currentNode.parent) {
				context.closingTagBuffer = "" // Reset tag buffer for closing tag name
				return closingTagState
			} else {
				// No active node but saw </... treat as literal text
				if (context.relaxedMode) {
					// In relaxed mode, treat as regular text
					context.textBuffer += "</"
					return textState
				} else {
					context.emitError("Closing tag without matching opening tag")
					context.textBuffer += "</"
					return textState
				}
			}
		} else if (/\s/.test(char)) {
			// Whitespace after < is invalid
			if (context.relaxedMode) {
				// In relaxed mode, treat as regular text
				context.textBuffer += `<${char}`
				return textState
			} else {
				context.emitError("Unexpected whitespace after '<'")
				context.textBuffer += `<${char}`
				return textState
			}
		} else {
			// Start of a tag name
			context.tagBuffer = char
			return tagNameState
		}
	}
}

// TagName state - parsing the tag name (for both tools and params)
class TagNameState implements ParserState {
	getStateType(): ParseStateEnum {
		return ParseStateEnum.TagName
	}

	processChar(context: ParserContext, char: string): ParserState {
		// Add the character to the buffer and check validity
		if (char !== ">" && !/\s/.test(char)) {
			context.tagBuffer += char

			// Check if the current buffer could still match any valid child tag
			if (!context.hasChildSchemaWithPrefix(context.tagBuffer)) {
				return this.handleInvalidTag(context, char)
			}

			return this
		}

		// Handling end of tag name (either > or whitespace)
		if (char === ">" || /\s/.test(char)) {
			const exactMatch = context.findChildSchema(context.tagBuffer)

			// If we have a match for the complete tag name
			if (exactMatch) {
				if (char === ">") {
					return this.handleValidTag(context, exactMatch)
				} else if (/\s/.test(char)) {
					// Whitespace after a tag name (e.g., in an attribute)
					context.emitError("Unexpected whitespace in parameter tag")
					return this.handleInvalidTag(context, char)
				}
			} else {
				return this.handleInvalidTag(context, char)
			}
		}

		return this
	}

	private handleValidTag(context: ParserContext, matchedSchema: NodeSchema): ParserState {
		// Update the current node to the matched schema
		context.currentNode = matchedSchema

		// If it's a tool node (doesn't have a parent that's the root)
		if (matchedSchema.parent === context.rootNode) {
			context.currentToolUse = {
				type: "tool_use",
				name: matchedSchema.name as ToolName,
				params: {},
				partial: true,
			}
			context.tagBuffer = ""

			return textContentState
		}
		// If it's a parameter node
		else if (matchedSchema.parent && matchedSchema.parent !== context.rootNode) {
			context.currentParamName = matchedSchema.name as ToolParamName
			context.paramValueBuffer = ""
			context.tagBuffer = ""

			// Parameter tags always allow text content in our model
			return textContentState
		}

		// Should never reach here, but just in case
		context.emitError(`Unexpected tag structure for ${matchedSchema.name}`)
		return textState
	}

	private handleInvalidTag(context: ParserContext, char: string): ParserState {
		// Check if this is attempting to be a tool tag but invalid
		const isAtRootLevel = context.currentNode === context.rootNode

		if (context.relaxedMode) {
			// In relaxed mode, treat invalid tag as text content
			if (isAtRootLevel) {
				context.textBuffer += `<${context.tagBuffer}${char}`
				context.tagBuffer = ""
				return textState
			} else if (context.canContainText()) {
				context.paramValueBuffer += `<${context.tagBuffer}${char}`
				context.tagBuffer = ""
				return textContentState
			}
		} else {
			// In strict mode, emit an appropriate error
			if (isAtRootLevel) {
				context.emitError(`Invalid tool name: ${context.tagBuffer}`)
				context.textBuffer += `<${context.tagBuffer}${char}`
				context.tagBuffer = ""
				return textState
			} else if (context.currentNode.parent === context.rootNode) {
				// Invalid parameter name for a tool
				context.emitError(`Invalid param name: ${context.tagBuffer} for tool ${context.currentNode.name}`)
				context.paramValueBuffer += `<${context.tagBuffer}${char}`
				context.tagBuffer = ""
				return textContentState
			} else if (context.canContainText()) {
				context.emitError(`Invalid tag name: ${context.tagBuffer} in ${context.currentNode.name}`)
				context.paramValueBuffer += `<${context.tagBuffer}${char}`
				context.tagBuffer = ""
				return textContentState
			}
		}

		// Reset to text state as fallback
		context.textBuffer += `<${context.tagBuffer}${char}`
		context.tagBuffer = ""
		context.currentNode = context.rootNode
		context.resetToolState()
		return textState
	}
}

// TextContent state - collecting content (parameter value or text within allowed tags)
class TextContentState implements ParserState {
	getStateType(): ParseStateEnum {
		return ParseStateEnum.TextContent
	}

	processChar(context: ParserContext, char: string): ParserState {
		if (char === "<") {
			// This might be a closing tag or a nested tag
			context.tagBuffer = "" // Reset tag buffer before transitioning
			return tagOpeningState
		} else {
			// Collect text content - either for parameter values or other text content
			if (context.currentParamName) {
				// We're collecting parameter value
				context.paramValueBuffer += char
			} else if (context.canContainText()) {
				// This node allows direct text content
				context.textBuffer += char
			} else if (/\s/.test(char)) {
				// Allow whitespace characters (spaces and newlines) in tool contexts
				// We silently ignore these to make the parser more flexible
				return this
			} else {
				// We're in a tool context that doesn't allow direct text
				context.emitError(`Unexpected character "${char}" in ${context.currentNode.name} context`)
				// Try to recover by treating as text
				context.textBuffer += char
			}
			return this
		}
	}
}

// ClosingTag state - handling </tag_name> structures
class ClosingTagState implements ParserState {
	getStateType(): ParseStateEnum {
		return ParseStateEnum.ClosingTag
	}

	processChar(context: ParserContext, char: string): ParserState {
		if (char === ">") {
			// End of closing tag, process it
			return this.processClosingTag(context)
		} else {
			// Accumulate the closing tag name
			context.closingTagBuffer += char

			// Early validation: Check if the current buffer matches the current node's name
			const currentNodeName = context.currentNode.name
			const bufferPrefix = currentNodeName.substring(0, context.closingTagBuffer.length)

			// If the buffer doesn't match the corresponding prefix of the node name, it can't be a match
			if (bufferPrefix !== context.closingTagBuffer) {
				return this.handleMismatchedClosingTag(context)
			}

			return this
		}
	}

	private handleMismatchedClosingTag(context: ParserContext): ParserState {
		const tagName = context.closingTagBuffer

		if (context.relaxedMode && context.canContainText()) {
			// In relaxed mode, treat mismatched closing tags as content
			if (context.currentParamName) {
				// We're inside a parameter, treat the mismatched tag as part of the value
				context.paramValueBuffer += `</${tagName}`
				context.closingTagBuffer = ""
				return textContentState
			} else {
				// Not in a parameter, treat as regular text
				context.textBuffer += `</${tagName}`
				context.closingTagBuffer = ""
				return textState
			}
		} else {
			// In strict mode, emit an error
			context.emitError(`Mismatched closing tag: expected </${context.currentNode.name}> but got </${tagName}`)

			if (context.canContainText()) {
				if (context.currentParamName) {
					context.paramValueBuffer += `</${tagName}`
					context.closingTagBuffer = ""
					return textContentState
				} else {
					context.textBuffer += `</${tagName}`
					context.closingTagBuffer = ""
					return textState
				}
			} else {
				// Reset to text state
				context.textBuffer += `</${tagName}`
				context.closingTagBuffer = ""
				context.currentNode = context.rootNode
				context.resetToolState()
				return textState
			}
		}
	}

	private processClosingTag(context: ParserContext): ParserState {
		const tagName = context.closingTagBuffer

		// Check if the closing tag matches the current node's name
		if (context.currentNode.name === tagName) {
			// If it's a parameter node
			if (context.currentParamName === tagName) {
				context.storeCurrentParamValue()
				context.resetParamState()
			}
			// If it's a tool node
			else if (context.currentToolUse?.name === tagName) {
				if (!context.currentToolUse.params) context.currentToolUse.params = {}
				context.emitBlock({ ...context.currentToolUse, partial: false })
				context.resetToolState()
			}

			// Move up to parent node
			context.currentNode = context.currentNode.parent!
			context.closingTagBuffer = ""

			// If we're back at the root, go to text state
			if (context.currentNode === context.rootNode) {
				return textState
			} else {
				// Otherwise, we're inside a parent tag
				return textContentState
			}
		}

		// Mismatched tag
		if (context.relaxedMode && context.canContainText()) {
			// In relaxed mode, treat mismatched closing tags as content
			if (context.currentParamName) {
				// We're inside a parameter, treat the mismatched tag as part of the value
				context.paramValueBuffer += `</${tagName}>`
				return textContentState
			} else {
				// Not in a parameter, treat as regular text
				context.textBuffer += `</${tagName}>`
				return textState
			}
		} else {
			// In strict mode, emit an error
			context.emitError(`Mismatched closing tag: expected </${context.currentNode.name}> but got </${tagName}>`)

			if (context.canContainText()) {
				if (context.currentParamName) {
					context.paramValueBuffer += `</${tagName}>`
					return textContentState
				} else {
					context.textBuffer += `</${tagName}>`
					return textState
				}
			} else {
				// Reset to text state
				context.textBuffer += `</${tagName}>`
				context.currentNode = context.rootNode
				context.resetToolState()
				return textState
			}
		}
	}
}
