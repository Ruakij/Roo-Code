import { render, screen, fireEvent } from "@testing-library/react"
import { ThinkingBudget } from "../ThinkingBudget"
import { ModelInfo } from "@roo/shared/api"

jest.mock("@/components/ui", () => ({
	Slider: ({ value, onValueChange, min, max }: any) => (
		<input
			type="range"
			data-testid="slider"
			min={min}
			max={max}
			value={value[0]}
			onChange={(e) => onValueChange([parseInt(e.target.value)])}
		/>
	),
}))

jest.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeCheckbox: ({ checked, onChange, children, ...props }: any) => (
		<label>
			<input type="checkbox" checked={checked} onChange={onChange} {...props} />
			{children}
		</label>
	),
}))

describe("ThinkingBudget", () => {
	const mockModelInfo: ModelInfo = {
		thinking: true,
		maxTokens: 16384,
		maxThinkingTokens: 8192,
		contextWindow: 200000,
		supportsPromptCache: true,
		supportsImages: true,
	}

	const defaultProps = {
		apiConfiguration: {},
		setApiConfigurationField: jest.fn(),
		modelInfo: mockModelInfo,
	}

	beforeEach(() => {
		jest.clearAllMocks()
	})

	it("should render nothing when model doesn't support thinking", () => {
		const { container } = render(
			<ThinkingBudget
				{...defaultProps}
				modelInfo={{
					...mockModelInfo,
					thinking: false,
					maxTokens: 16384,
					contextWindow: 200000,
					supportsPromptCache: true,
					supportsImages: true,
				}}
			/>,
		)

		expect(container.firstChild).toBeNull()
	})

	it("should render max tokens slider and checkbox when model supports thinking", () => {
		render(<ThinkingBudget {...defaultProps} />)

		// Should have max tokens slider
		expect(screen.getAllByTestId("slider")).toHaveLength(1)
		// Should have manual thinking budget checkbox
		expect(screen.getByTestId("manual-thinking-budget-checkbox")).toBeInTheDocument()
	})

	it("should render thinking tokens slider when manual control is enabled", () => {
		render(<ThinkingBudget {...defaultProps} apiConfiguration={{ manualThinkingBudgetEnabled: true }} />)

		// Should have both max tokens and thinking tokens sliders
		expect(screen.getAllByTestId("slider")).toHaveLength(2)
	})

	it("should update modelMaxThinkingTokens when manual control is enabled", () => {
		const setApiConfigurationField = jest.fn()

		render(
			<ThinkingBudget
				{...defaultProps}
				apiConfiguration={{
					modelMaxThinkingTokens: 4096,
					manualThinkingBudgetEnabled: true,
				}}
				setApiConfigurationField={setApiConfigurationField}
			/>,
		)

		const sliders = screen.getAllByTestId("slider")
		fireEvent.change(sliders[1], { target: { value: "5000" } })

		expect(setApiConfigurationField).toHaveBeenCalledWith("modelMaxThinkingTokens", 5000)
	})

	it("should cap thinking tokens at 80% of max tokens when manual control is enabled", () => {
		const setApiConfigurationField = jest.fn()

		render(
			<ThinkingBudget
				{...defaultProps}
				apiConfiguration={{
					modelMaxTokens: 10000,
					modelMaxThinkingTokens: 9000,
					manualThinkingBudgetEnabled: true,
				}}
				setApiConfigurationField={setApiConfigurationField}
			/>,
		)

		// Effect should trigger and cap the value
		expect(setApiConfigurationField).toHaveBeenCalledWith("modelMaxThinkingTokens", 8000) // 80% of 10000
	})

	it("should use default thinking tokens if not provided when manual control is enabled", () => {
		render(
			<ThinkingBudget
				{...defaultProps}
				apiConfiguration={{
					modelMaxTokens: 10000,
					manualThinkingBudgetEnabled: true,
				}}
			/>,
		)

		// Default is 80% of max tokens, capped at 8192
		const sliders = screen.getAllByTestId("slider")
		expect(sliders[1]).toHaveValue("8000") // 80% of 10000
	})

	it("should use min thinking tokens of 1024 when manual control is enabled", () => {
		render(
			<ThinkingBudget
				{...defaultProps}
				apiConfiguration={{
					modelMaxTokens: 1000,
					manualThinkingBudgetEnabled: true,
				}}
			/>,
		)

		const sliders = screen.getAllByTestId("slider")
		expect(sliders[1].getAttribute("min")).toBe("1024")
	})

	it("should update max tokens when slider changes", () => {
		const setApiConfigurationField = jest.fn()

		render(
			<ThinkingBudget
				{...defaultProps}
				apiConfiguration={{ modelMaxTokens: 10000 }}
				setApiConfigurationField={setApiConfigurationField}
			/>,
		)

		const sliders = screen.getAllByTestId("slider")
		fireEvent.change(sliders[0], { target: { value: "12000" } })

		expect(setApiConfigurationField).toHaveBeenCalledWith("modelMaxTokens", 12000)
	})

	describe("supportsThinkingBudgetControl", () => {
		it("should disable manual control when model does not support thinking budget control", () => {
			render(
				<ThinkingBudget
					{...defaultProps}
					modelInfo={{
						...mockModelInfo,
						maxThinkingTokens: undefined,
					}}
				/>,
			)

			const checkbox = screen.getByTestId("manual-thinking-budget-checkbox")
			expect(checkbox).toBeDisabled()

			// Should show "not supported" description
			expect(screen.getByText("settings:thinkingBudget.notSupportedDescription")).toBeInTheDocument()

			// Should not show thinking budget slider even if enabled
			render(
				<ThinkingBudget
					{...defaultProps}
					modelInfo={{
						...mockModelInfo,
						maxThinkingTokens: undefined,
					}}
					apiConfiguration={{ manualThinkingBudgetEnabled: true }}
				/>,
			)
			expect(screen.queryByTestId("thinking-budget")).not.toBeInTheDocument()
		})

		it("should enable manual control when model supports thinking budget control", () => {
			render(<ThinkingBudget {...defaultProps} />)

			const checkbox = screen.getByTestId("manual-thinking-budget-checkbox")
			expect(checkbox).not.toBeDisabled()

			// Should show "auto control" description initially
			expect(screen.getByText("settings:thinkingBudget.autoControlDescription")).toBeInTheDocument()

			// Enable manual control
			render(<ThinkingBudget {...defaultProps} apiConfiguration={{ manualThinkingBudgetEnabled: true }} />)

			// Should show "manual control" description
			expect(screen.getByText("settings:thinkingBudget.manualControlDescription")).toBeInTheDocument()
		})
	})

	describe("handleManualThinkingBudgetToggle", () => {
		it("should enable manual control with default thinking tokens", () => {
			const setApiConfigurationField = jest.fn()

			render(
				<ThinkingBudget
					{...defaultProps}
					apiConfiguration={{ manualThinkingBudgetEnabled: false }}
					setApiConfigurationField={setApiConfigurationField}
				/>,
			)

			const checkbox = screen.getByRole("checkbox")
			fireEvent.click(checkbox)

			expect(setApiConfigurationField).toHaveBeenCalledWith("manualThinkingBudgetEnabled", true)
			expect(setApiConfigurationField).toHaveBeenCalledWith("modelMaxThinkingTokens", 8192)
			expect(setApiConfigurationField).toHaveBeenCalledTimes(2)
		})

		it("should disable manual control and clear thinking tokens", () => {
			const setApiConfigurationField = jest.fn()

			render(
				<ThinkingBudget
					{...defaultProps}
					apiConfiguration={{
						manualThinkingBudgetEnabled: true,
						modelMaxThinkingTokens: 4096,
					}}
					setApiConfigurationField={setApiConfigurationField}
				/>,
			)

			const checkbox = screen.getByRole("checkbox")
			fireEvent.click(checkbox)

			expect(setApiConfigurationField).toHaveBeenCalledWith("manualThinkingBudgetEnabled", false)
			expect(setApiConfigurationField).toHaveBeenCalledWith("modelMaxThinkingTokens", undefined)
			expect(setApiConfigurationField).toHaveBeenCalledTimes(2)
		})
	})
})
