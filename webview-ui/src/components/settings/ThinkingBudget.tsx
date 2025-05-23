import { useEffect } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"

import { Slider } from "@/components/ui"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"

import { ProviderSettings, ModelInfo } from "@roo/shared/api"

const DEFAULT_MAX_OUTPUT_TOKENS = 16_384
const DEFAULT_MAX_THINKING_TOKENS = 8_192

interface ThinkingBudgetProps {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: <K extends keyof ProviderSettings>(field: K, value: ProviderSettings[K]) => void
	modelInfo?: ModelInfo
}

export const ThinkingBudget = ({ apiConfiguration, setApiConfigurationField, modelInfo }: ThinkingBudgetProps) => {
	const { t } = useAppTranslation()

	const isThinkingModel = !!modelInfo && !!modelInfo.thinking && !!modelInfo.maxTokens
	const supportsThinkingBudgetControl = isThinkingModel && modelInfo.maxThinkingTokens

	const customMaxOutputTokens = apiConfiguration.modelMaxTokens || DEFAULT_MAX_OUTPUT_TOKENS
	const customMaxThinkingTokens = apiConfiguration.modelMaxThinkingTokens || DEFAULT_MAX_THINKING_TOKENS

	// Dynamically expand or shrink the max thinking budget based on the custom
	// max output tokens so that there's always a 20% buffer.
	const modelMaxThinkingTokens = modelInfo?.maxThinkingTokens
		? Math.min(modelInfo.maxThinkingTokens, Math.floor(0.8 * customMaxOutputTokens))
		: Math.floor(0.8 * customMaxOutputTokens)

	// If the custom max thinking tokens are going to exceed it's limit due
	// to the custom max output tokens being reduced then we need to shrink it
	// appropriately.
	useEffect(() => {
		if (
			isThinkingModel &&
			apiConfiguration.manualThinkingBudgetEnabled &&
			customMaxThinkingTokens > modelMaxThinkingTokens
		) {
			setApiConfigurationField("modelMaxThinkingTokens", modelMaxThinkingTokens)
		}
	}, [
		isThinkingModel,
		apiConfiguration.manualThinkingBudgetEnabled,
		customMaxThinkingTokens,
		modelMaxThinkingTokens,
		setApiConfigurationField,
	])

	// Handler for toggling manual thinking budget control
	const handleManualThinkingBudgetToggle = (event: any) => {
		const enabled = event.target.checked
		setApiConfigurationField("manualThinkingBudgetEnabled", enabled)

		if (enabled) {
			// Enable manual control - set to default value if not already set
			if (apiConfiguration.modelMaxThinkingTokens === undefined) {
				setApiConfigurationField("modelMaxThinkingTokens", DEFAULT_MAX_THINKING_TOKENS)
			}
		} else {
			setApiConfigurationField("modelMaxThinkingTokens", undefined)
		}
	}

	return isThinkingModel ? (
		<>
			<div className="flex flex-col gap-1">
				<div className="font-medium">{t("settings:thinkingBudget.maxTokens")}</div>
				<div className="flex items-center gap-1">
					<Slider
						min={8192}
						max={modelInfo.maxTokens!}
						step={1024}
						value={[customMaxOutputTokens]}
						onValueChange={([value]) => setApiConfigurationField("modelMaxTokens", value)}
					/>
					<div className="w-12 text-sm text-center">{customMaxOutputTokens}</div>
				</div>
			</div>
			<div className="flex flex-col gap-1">
				<VSCodeCheckbox
					checked={apiConfiguration.manualThinkingBudgetEnabled}
					onChange={handleManualThinkingBudgetToggle}
					disabled={!supportsThinkingBudgetControl}
					data-testid="manual-thinking-budget-checkbox">
					<span className="font-medium">{t("settings:thinkingBudget.manualControl")}</span>
				</VSCodeCheckbox>
				<div className="text-xs text-vscode-descriptionForeground">
					{!supportsThinkingBudgetControl
						? t("settings:thinkingBudget.notSupportedDescription")
						: apiConfiguration.manualThinkingBudgetEnabled
							? t("settings:thinkingBudget.manualControlDescription")
							: t("settings:thinkingBudget.autoControlDescription")}
				</div>
				{supportsThinkingBudgetControl && apiConfiguration.manualThinkingBudgetEnabled && (
					<div className="flex flex-col gap-1">
						<div className="font-medium">{t("settings:thinkingBudget.maxThinkingTokens")}</div>
						<div className="flex items-center gap-1" data-testid="thinking-budget">
							<Slider
								min={1024}
								max={modelMaxThinkingTokens}
								step={1024}
								value={[customMaxThinkingTokens]}
								onValueChange={([value]) => setApiConfigurationField("modelMaxThinkingTokens", value)}
							/>
							<div className="w-12 text-sm text-center">{customMaxThinkingTokens}</div>
						</div>
					</div>
				)}
			</div>
		</>
	) : null
}
