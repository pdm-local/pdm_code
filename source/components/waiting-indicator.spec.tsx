import test from 'ava';
import {render} from 'ink-testing-library';
import React from 'react';
import stripAnsi from 'strip-ansi';
import {themes} from '../config/themes';
import {ThemeContext} from '../hooks/useTheme';
import WaitingIndicator from './waiting-indicator';

console.log(`\nwaiting-indicator.spec.tsx, ${React.version}`);

function TestThemeProvider({children}: {children: React.ReactNode}) {
	const themeContextValue = {
		currentTheme: 'tokyo-night' as const,
		colors: themes['tokyo-night'].colors,
		setCurrentTheme: () => {},
	};

	return (
		<ThemeContext.Provider value={themeContextValue}>
			{children}
		</ThemeContext.Provider>
	);
}

function renderIndicator(model: string) {
	const {lastFrame, unmount} = render(
		<TestThemeProvider>
			<WaitingIndicator model={model} />
		</TestThemeProvider>,
	);
	const frame = stripAnsi(lastFrame() ?? '');
	unmount();
	return frame;
}

test('WaitingIndicator names the model it is waiting on', t => {
	const frame = renderIndicator('qwen3.8:27b-q4_K_M-pdm');
	t.true(
		frame.includes('qwen3.8:27b-q4_K_M-pdm'),
		'the model name is what tells the user which load is slow',
	);
});

test('WaitingIndicator states that it is waiting for the first token', t => {
	const frame = renderIndicator('gemma4:12b-pdm');
	t.true(frame.includes('waiting for the first token'));
});

test('WaitingIndicator offers a way out', t => {
	const frame = renderIndicator('gemma4:12b-pdm');
	t.true(
		frame.includes('Escape'),
		'a long wait is only tolerable if the user knows it is interruptible',
	);
});

test('WaitingIndicator omits the elapsed counter before it means anything', t => {
	const frame = renderIndicator('gemma4:12b-pdm');
	t.false(/·\s\d+s/.test(frame), 'no seconds counter on the first frame');
});
