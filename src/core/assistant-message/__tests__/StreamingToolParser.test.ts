import { StreamingToolParser } from "../StreamingToolParser"
import { ToolParamName } from "../../../shared/tools"
import { ToolName } from "../../../schemas"

describe("StreamingToolParser", () => {
	// Setup reusable test data
	const validToolNames = new Set<ToolName>(["read_file", "write_to_file", "execute_command", "search_files"])

	const validParamNamesByTool = new Map<ToolName, Set<ToolParamName>>([
		["read_file", new Set(["path", "start_line", "end_line"])],
		["write_to_file", new Set(["path", "content", "line_count"])],
		["execute_command", new Set(["command", "cwd"])],
		["search_files", new Set(["path", "regex", "file_pattern"])],
	])

	let parser: StreamingToolParser

	beforeEach(() => {
		parser = new StreamingToolParser({
			validToolNames,
			validParamNamesByTool,
		})
	})

	describe("Basic Cases", () => {
		it("should emit text content", () => {
			const blocks: any[] = []
			parser.on("block", (block) => blocks.push(block))

			parser.processChunk("Hello world")
			parser.finalize()

			expect(blocks).toHaveLength(2)
			expect(blocks[0]).toEqual({
				type: "text",
				content: "Hello world",
				partial: true,
			})
			expect(blocks[1]).toEqual({
				type: "text",
				content: "Hello world",
				partial: false,
			})
		})

		it("should process a single tool call", () => {
			const blocks: any[] = []
			const errors: Error[] = []
			parser.on("block", (block) => blocks.push(block))
			parser.on("error", (error) => errors.push(error))

			parser.processChunk("<read_file><path>test.txt</path></read_file>")
			parser.finalize()

			expect(errors).toHaveLength(0)
			expect(blocks).toHaveLength(1)
			expect(blocks[0]).toEqual({
				type: "tool_use",
				name: "read_file",
				params: {
					path: "test.txt",
				},
				partial: false,
			})
		})
	})

	describe("Text and Tool Interactions", () => {
		it("should handle text/tool interleaving", () => {
			const blocks: any[] = []
			parser.on("block", (block) => blocks.push(block))

			parser.processChunk("Text before ")
			parser.processChunk("<read_file><path>test.txt</path></read_file>")
			parser.processChunk(" Text after")
			parser.finalize()

			expect(blocks).toHaveLength(5)
			expect(blocks[0]).toEqual({
				type: "text",
				content: "Text before ",
				partial: true,
			})
			expect(blocks[1]).toEqual({
				type: "text",
				content: "Text before ",
				partial: false,
			})
			expect(blocks[2]).toEqual({
				type: "tool_use",
				name: "read_file",
				params: {
					path: "test.txt",
				},
				partial: false,
			})
			expect(blocks[3]).toEqual({
				type: "text",
				content: " Text after",
				partial: true,
			})
			expect(blocks[4]).toEqual({
				type: "text",
				content: " Text after",
				partial: false,
			})
		})

		it("should handle only text content in a single chunk", () => {
			const blocks: any[] = []
			parser.on("block", (block) => blocks.push(block))

			parser.processChunk("Just simple text.")
			parser.finalize()

			expect(blocks).toHaveLength(2)
			expect(blocks[0]).toEqual({
				type: "text",
				content: "Just simple text.",
				partial: true,
			})
			expect(blocks[1]).toEqual({
				type: "text",
				content: "Just simple text.",
				partial: false,
			})
		})

		it("should handle only text content across multiple chunks", () => {
			const blocks: any[] = []
			parser.on("block", (block) => blocks.push(block))

			parser.processChunk("Part 1 ")
			parser.processChunk("and Part 2.")
			parser.finalize()

			expect(blocks).toHaveLength(3)
			expect(blocks[0]).toEqual({
				type: "text",
				content: "Part 1 ",
				partial: true,
			})
			expect(blocks[1]).toEqual({
				type: "text",
				content: "Part 1 and Part 2.",
				partial: true,
			})
			expect(blocks[2]).toEqual({
				type: "text",
				content: "Part 1 and Part 2.",
				partial: false,
			})
		})

		it("should handle a complete tool call in a single chunk", () => {
			const blocks: any[] = []
			parser.on("block", (block) => blocks.push(block))

			parser.processChunk("<read_file><path>file.txt</path></read_file>")
			parser.finalize()

			expect(blocks).toHaveLength(1)
			expect(blocks[0]).toEqual({
				type: "tool_use",
				name: "read_file",
				params: {
					path: "file.txt",
				},
				partial: false,
			})
		})

		it("should handle a complete tool call across multiple chunks", () => {
			const blocks: any[] = []
			parser.on("block", (block) => blocks.push(block))

			parser.processChunk("<read_file><path>file")
			parser.processChunk(".txt</path></read_")
			parser.processChunk("file>")
			parser.finalize()

			expect(blocks).toHaveLength(3)
			expect(blocks[0]).toEqual({
				type: "tool_use",
				name: "read_file",
				params: {
					path: "file",
				},
				partial: true,
			})
			expect(blocks[1]).toEqual({
				type: "tool_use",
				name: "read_file",
				params: {
					path: "file.txt",
				},
				partial: true,
			})
			expect(blocks[2]).toEqual({
				type: "tool_use",
				name: "read_file",
				params: {
					path: "file.txt",
				},
				partial: false,
			})
		})

		it("should handle an incomplete tool call across multiple chunks on finalize", () => {
			const blocks: any[] = []
			parser.on("block", (block) => blocks.push(block))

			parser.processChunk("<read_file><path>file")
			parser.processChunk(".txt</path>") // Missing closing tool tag
			parser.finalize()

			expect(blocks).toHaveLength(2)
			expect(blocks[0]).toEqual({
				type: "tool_use",
				name: "read_file",
				params: {
					path: "file",
				},
				partial: true,
			})
			expect(blocks[1]).toEqual({
				type: "tool_use",
				name: "read_file",
				params: {
					path: "file.txt",
				},
				partial: true,
			})
		})
	})

	describe("Complex Streaming Scenarios", () => {
		it("should mark text as non-partial when followed by a tool", () => {
			const blocks: any[] = []
			parser.on("block", (block) => blocks.push(block))

			parser.processChunk("Some initial text ")
			parser.processChunk("<read_file><path>file.txt</path></read_file>")
			parser.finalize()

			expect(blocks).toHaveLength(3)
			expect(blocks[0]).toEqual({
				type: "text",
				content: "Some initial text ",
				partial: true,
			})
			expect(blocks[1]).toEqual({
				type: "text",
				content: "Some initial text ",
				partial: false,
			})
			expect(blocks[2]).toEqual({
				type: "tool_use",
				name: "read_file",
				params: {
					path: "file.txt",
				},
				partial: false,
			})
		})

		it("should handle text, tool, and text within a single chunk", () => {
			const blocks: any[] = []
			parser.on("block", (block) => blocks.push(block))

			parser.processChunk("Text before <read_file><path>f.txt</path></read_file> text after")
			parser.finalize()

			expect(blocks).toHaveLength(4)
			expect(blocks[0]).toEqual({
				type: "text",
				content: "Text before ",
				partial: false,
			})
			expect(blocks[1]).toEqual({
				type: "tool_use",
				name: "read_file",
				params: {
					path: "f.txt",
				},
				partial: false,
			})
			expect(blocks[2]).toEqual({
				type: "text",
				content: " text after",
				partial: true,
			})
			expect(blocks[3]).toEqual({
				type: "text",
				content: " text after",
				partial: false,
			})
		})

		it("should handle text and tool streamed across multiple chunks", () => {
			const blocks: any[] = []
			parser.on("block", (block) => blocks.push(block))

			parser.processChunk("Text bef")
			parser.processChunk("ore <read_")
			parser.processChunk("file><path>f.txt</path></read_")
			parser.processChunk("file> text")
			parser.processChunk(" after")
			parser.finalize()

			expect(blocks).toHaveLength(7)
			expect(blocks[0]).toEqual({
				type: "text",
				content: "Text bef",
				partial: true,
			})
			expect(blocks[1]).toEqual({
				type: "text",
				content: "Text before ",
				partial: false,
			})
			expect(blocks[2]).toEqual({
				type: "tool_use",
				name: "read_file",
				params: {
					path: "f.txt",
				},
				partial: true,
			})
			expect(blocks[3]).toEqual({
				type: "tool_use",
				name: "read_file",
				params: {
					path: "f.txt",
				},
				partial: false,
			})
			expect(blocks[4]).toEqual({
				type: "text",
				content: " text",
				partial: true,
			})
			expect(blocks[5]).toEqual({
				type: "text",
				content: " text after",
				partial: true,
			})
			expect(blocks[6]).toEqual({
				type: "text",
				content: " text after",
				partial: false,
			})
		})
	})

	describe("Multiple Tools", () => {
		it("should handle sequential tool calls", () => {
			const blocks: any[] = []
			parser.on("block", (block) => blocks.push(block))

			parser.processChunk(`
                <read_file><path>first.txt</path></read_file>
                <read_file><path>second.txt</path></read_file>
            `)
			parser.finalize()

			expect(blocks.filter((b) => b.type === "tool_use")).toHaveLength(2)
			expect(blocks.find((b) => b.type === "tool_use" && b.params.path === "first.txt")).toBeTruthy()
			expect(blocks.find((b) => b.type === "tool_use" && b.params.path === "second.txt")).toBeTruthy()
		})
	})

	describe("Parameter Variations", () => {
		it("should handle zero parameters", () => {
			const blocks: any[] = []
			parser.on("block", (block) => blocks.push(block))

			parser.processChunk("<read_file></read_file>")
			parser.finalize()

			expect(blocks[0]).toEqual({
				type: "tool_use",
				name: "read_file",
				params: {},
				partial: false,
			})
		})

		it("should handle multiple parameters", () => {
			const blocks: any[] = []
			parser.on("block", (block) => blocks.push(block))

			parser.processChunk(
				"<read_file><path>test.txt</path><start_line>1</start_line><end_line>10</end_line></read_file>",
			)
			parser.finalize()

			expect(blocks[0]).toEqual({
				type: "tool_use",
				name: "read_file",
				params: {
					path: "test.txt",
					start_line: "1",
					end_line: "10",
				},
				partial: false,
			})
		})

		it("should handle empty parameters", () => {
			const blocks: any[] = []
			parser.on("block", (block) => blocks.push(block))

			parser.processChunk("<read_file><path></path></read_file>")
			parser.finalize()

			expect(blocks[0]).toEqual({
				type: "tool_use",
				name: "read_file",
				params: {
					path: "",
				},
				partial: false,
			})
		})

		it("should handle parameters with whitespace", () => {
			const blocks: any[] = []
			parser.on("block", (block) => blocks.push(block))

			parser.processChunk("<read_file><path>  test.txt  </path></read_file>")
			parser.finalize()

			expect(blocks[0]).toEqual({
				type: "tool_use",
				name: "read_file",
				params: {
					path: "  test.txt  ",
				},
				partial: false,
			})
		})
	})

	describe("Error Cases", () => {
		it("should emit error for invalid tool name", () => {
			const errors: Error[] = []
			parser.on("error", (error) => errors.push(error))

			parser.processChunk("<invalid_tool></invalid_tool>")
			parser.finalize()

			expect(errors[0].message).toContain("Invalid tool name")
		})

		it("should emit error for invalid parameter name", () => {
			const errors: Error[] = []
			parser.on("error", (error) => errors.push(error))

			parser.processChunk("<read_file><invalid_param>value</invalid_param></read_file>")
			parser.finalize()

			expect(errors[0].message).toContain("Invalid param")
		})

		it("should emit error for mismatched closing tag", () => {
			const errors: Error[] = []
			parser.on("error", (error) => errors.push(error))

			parser.processChunk("<read_file><path>test.txt</wrong_tag></read_file>")
			parser.finalize()

			expect(errors[0].message).toContain("Mismatched closing tag")
		})

		it("should emit error for unexpected whitespace after opening <", () => {
			const errors: Error[] = []
			parser.on("error", (error) => errors.push(error))

			parser.processChunk("< read_file></read_file>")
			parser.finalize()

			expect(errors[0].message).toContain("Unexpected whitespace after")
		})

		it("should emit error for unexpected whitespace in parameter tag", () => {
			const errors: Error[] = []
			parser.on("error", (error) => errors.push(error))

			parser.processChunk('<read_file><path attribute="value">test.txt</path></read_file>')
			parser.finalize()

			expect(errors[0].message).toContain("Unexpected whitespace in parameter tag")
		})

		it("should emit error for unexpected character in tool context", () => {
			const errors: Error[] = []
			parser.on("error", (error) => errors.push(error))

			parser.processChunk("<read_file>unexpected</read_file>")
			parser.finalize()

			expect(errors[0].message).toContain("Unexpected character")
		})
	})

	describe.skip("Single-Char Fence Edge Cases", () => {
		it("should handle < and > characters within parameter values", () => {
			const blocks: any[] = []
			parser.on("block", (block) => blocks.push(block))

			parser.processChunk("<read_file><path>file_with_<_and_>_chars.txt</path></read_file>")
			parser.finalize()

			expect(blocks[0]).toEqual({
				type: "tool_use",
				name: "read_file",
				params: {
					path: "file_with_<_and_>_chars.txt",
				},
				partial: false,
			})
		})

		it("should properly treat < within parameter values", () => {
			const blocks: any[] = []
			parser.on("block", (block) => blocks.push(block))

			parser.processChunk("<read_file><path>x < y</path></read_file>")
			parser.finalize()

			// The parser should handle the < specially in parameter values
			expect(blocks[0].params.path).toEqual("x < y")
		})

		it("should handle angle brackets in math expressions", () => {
			const blocks: any[] = []
			const errors: Error[] = []
			parser.on("block", (block) => blocks.push(block))
			parser.on("error", (error) => errors.push(error))

			parser.processChunk("For math: if x < 3 and y > 2 then x + y < 10")
			parser.finalize()

			expect(errors).toHaveLength(0)
			expect(blocks.find((b) => b.type === "text")?.content).toBe("For math: if x < 3 and y > 2 then x + y < 10")
		})

		it("should properly handle multiple < characters in complex content", () => {
			const blocks: any[] = []
			parser.on("block", (block) => blocks.push(block))

			parser.processChunk("Text <read_file><path>file.txt</path></read_file> more text with < and > symbols")
			parser.finalize()

			expect(blocks[0]).toEqual({
				type: "text",
				content: "Text ",
				partial: false,
			})

			expect(blocks[1]).toEqual({
				type: "tool_use",
				name: "read_file",
				params: {
					path: "file.txt",
				},
				partial: false,
			})

			expect(blocks[2].type).toBe("text")
			expect(blocks[2].content).toContain("more text with < and > symbols")
		})
	})
})
