use {
    glam::{vec2, Vec2},
    std::{collections::HashSet, sync::LazyLock},
    winit::{
        event::{
            DeviceEvent, ElementState, KeyEvent, MouseButton as WMouseButton, MouseScrollDelta,
            WindowEvent,
        },
        keyboard::{KeyCode, PhysicalKey},
    },
};

#[derive(Default, Debug)]
pub struct Input {
    current_frame: InputState,
    last_frame: InputState,
}

impl Input {
    pub fn next_frame(&mut self) {
        let last = std::mem::take(&mut self.current_frame);
        self.current_frame = InputState::from_last(&last);
        self.last_frame = last;
    }

    pub fn handle_device_event(&mut self, event: &DeviceEvent) {
        match event {
            DeviceEvent::MouseMotion { delta } => self.handle_mouse_move(delta),
            _ => {}
        }
    }

    pub fn handle_window_event(&mut self, event: &WindowEvent) {
        match event {
            WindowEvent::KeyboardInput {
                event:
                    KeyEvent {
                        physical_key,
                        state,
                        ..
                    },
                ..
            } => self.handle_key(physical_key, state),
            WindowEvent::MouseInput { state, button, .. } =>
                self.handle_mouse_button(button, state),
            WindowEvent::MouseWheel { delta, .. } => self.handle_mouse_scroll(delta),

            _ => {}
        }
    }

    fn handle_mouse_move(&mut self, delta: &(f64, f64)) {
        self.current_frame.mouse_move_delta += vec2(delta.0 as f32, delta.1 as f32);
    }

    fn handle_mouse_scroll(&mut self, delta: &MouseScrollDelta) {
        let delta = match delta {
            MouseScrollDelta::LineDelta(x, y) => vec2(*x, *y),
            MouseScrollDelta::PixelDelta(pos) => vec2(pos.x as f32, pos.y as f32),
        };

        self.current_frame.mouse_scroll_delta += delta;
    }

    fn handle_mouse_button(&mut self, button: &WMouseButton, state: &ElementState) {
        let button = MouseButton::from_winit(*button);
        match state {
            ElementState::Pressed => {
                self.current_frame.mouse_held.insert(button);
                self.current_frame.mouse_pressed.insert(button);
            }
            ElementState::Released => {
                self.current_frame.mouse_held.remove(&button);
            }
        };
    }

    fn handle_key(&mut self, key: &PhysicalKey, state: &ElementState) {
        let key = match key {
            PhysicalKey::Code(code) => Key::from_winit(code),
            PhysicalKey::Unidentified(code) => {
                log::warn!("Unhandled key input: {code:?}");
                return;
            }
        };
        match state {
            ElementState::Pressed => {
                self.current_frame.keys_pressed.insert(key);
                self.current_frame.keys_held.insert(key);
                self.current_frame.key_events.push((key, KeyState::Down));
            }
            ElementState::Released => {
                self.current_frame.keys_held.remove(&key);
                self.current_frame.keys_released.insert(key);
                self.current_frame.key_events.push((key, KeyState::Up));
            }
        }
    }

    pub fn key_events(&self) -> Vec<&(Key, KeyState)> {
        self.last_frame.key_events.iter().collect::<Vec<_>>()
    }

    pub fn pressed_keys(&self) -> &HashSet<Key> { &self.last_frame.keys_pressed }

    pub fn key_pressed(&self, key: &Key) -> bool { self.last_frame.keys_pressed.contains(key) }

    pub fn key_held(&self, key: &Key) -> bool { self.last_frame.keys_held.contains(key) }

    pub fn key_released(&self, key: &Key) -> bool { self.last_frame.keys_released.contains(key) }

    pub fn mouse_clicked(&self, button: &MouseButton) -> bool {
        self.last_frame.mouse_pressed.contains(button)
    }

    pub fn mouse_released(&self, button: &MouseButton) -> bool {
        self.last_frame.mouse_released.contains(button)
    }

    pub fn mouse_button_held(&self, button: &MouseButton) -> bool {
        self.last_frame.mouse_held.contains(button)
    }

    pub fn mouse_delta(&self) -> (f32, f32) {
        let delta = self.last_frame.mouse_move_delta;
        (delta.x, delta.y)
    }

    pub fn mouse_scroll_delta(&self) -> Option<(f32, f32)> {
        let delta = self.last_frame.mouse_scroll_delta;
        if delta.x.abs() > 0.1 || delta.y.abs() > 0.1 {
            return Some((delta.x, delta.y));
        }
        None
    }
}

#[derive(Default, Debug)]
pub struct InputState {
    key_events: Vec<(Key, KeyState)>,
    keys_pressed: HashSet<Key>,
    keys_held: HashSet<Key>,
    keys_released: HashSet<Key>,
    mouse_pressed: HashSet<MouseButton>,
    mouse_released: HashSet<MouseButton>,
    mouse_held: HashSet<MouseButton>,
    mouse_move_delta: Vec2,
    mouse_scroll_delta: Vec2,
}

impl InputState {
    pub fn from_last(prev_state: &InputState) -> Self {
        Self {
            keys_held: prev_state.keys_held.clone(),
            mouse_held: prev_state.mouse_held.clone(),
            ..Default::default()
        }
    }
}

#[derive(Debug, PartialEq)]
pub enum InteractionState {
    Down,
    Up,
}

pub type KeyState = InteractionState;

#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, PartialOrd, Eq, Hash)]
pub enum Key {
    Backquote,
    Backslash,
    BracketLeft,
    BracketRight,
    Comma,
    Digit0,
    Digit1,
    Digit2,
    Digit3,
    Digit4,
    Digit5,
    Digit6,
    Digit7,
    Digit8,
    Digit9,
    Equal,
    IntlBackslash,
    IntlRo,
    IntlYen,
    KeyA,
    KeyB,
    KeyC,
    KeyD,
    KeyE,
    KeyF,
    KeyG,
    KeyH,
    KeyI,
    KeyJ,
    KeyK,
    KeyL,
    KeyM,
    KeyN,
    KeyO,
    KeyP,
    KeyQ,
    KeyR,
    KeyS,
    KeyT,
    KeyU,
    KeyV,
    KeyW,
    KeyX,
    KeyY,
    KeyZ,
    Minus,
    Period,
    Quote,
    Semicolon,
    Slash,
    AltLeft,
    AltRight,
    Backspace,
    CapsLock,
    ContextMenu,
    ControlLeft,
    ControlRight,
    Enter,
    MetaLeft,
    MetaRight,
    ShiftLeft,
    ShiftRight,
    Space,
    Tab,
    Delete,
    End,
    Help,
    Home,
    Insert,
    PageDown,
    PageUp,
    ArrowDown,
    ArrowLeft,
    ArrowRight,
    ArrowUp,
    NumLock,
    Numpad0,
    Numpad1,
    Numpad2,
    Numpad3,
    Numpad4,
    Numpad5,
    Numpad6,
    Numpad7,
    Numpad8,
    Numpad9,
    NumpadAdd,
    NumpadBackspace,
    NumpadClear,
    NumpadClearEntry,
    NumpadComma,
    NumpadDecimal,
    NumpadDivide,
    NumpadEnter,
    NumpadEqual,
    NumpadHash,
    NumpadMemoryAdd,
    NumpadMemoryClear,
    NumpadMemoryRecall,
    NumpadMemoryStore,
    NumpadMemorySubtract,
    NumpadMultiply,
    NumpadParenLeft,
    NumpadParenRight,
    NumpadStar,
    NumpadSubtract,
    Escape,
    F1,
    F2,
    F3,
    F4,
    F5,
    F6,
    F7,
    F8,
    F9,
    F10,
    F11,
    F12,
    Fn,
    FnLock,
    PrintScreen,
    ScrollLock,
    Pause,
    Unidentified,
}

impl Key {
    fn from_winit(key: &winit::keyboard::KeyCode) -> Self {
        use winit::keyboard::KeyCode as WKeyCode;
        match key {
            WKeyCode::Tab => Key::Tab,
            WKeyCode::Escape => Key::Escape,
            WKeyCode::Space => Key::Space,
            WKeyCode::Digit0 => Key::Digit0,
            WKeyCode::Digit1 => Key::Digit1,
            WKeyCode::Digit2 => Key::Digit2,
            WKeyCode::Digit3 => Key::Digit3,
            WKeyCode::Digit4 => Key::Digit4,
            WKeyCode::Digit5 => Key::Digit5,
            WKeyCode::Digit6 => Key::Digit6,
            WKeyCode::Digit7 => Key::Digit7,
            WKeyCode::Digit8 => Key::Digit8,
            WKeyCode::Digit9 => Key::Digit9,
            WKeyCode::Equal => Key::Equal,
            WKeyCode::Minus => Key::Minus,
            WKeyCode::KeyA => Key::KeyA,
            WKeyCode::KeyB => Key::KeyB,
            WKeyCode::KeyC => Key::KeyC,
            WKeyCode::KeyD => Key::KeyD,
            WKeyCode::KeyE => Key::KeyE,
            WKeyCode::KeyF => Key::KeyF,
            WKeyCode::KeyG => Key::KeyG,
            WKeyCode::KeyH => Key::KeyH,
            WKeyCode::KeyI => Key::KeyI,
            WKeyCode::KeyJ => Key::KeyJ,
            WKeyCode::KeyK => Key::KeyK,
            WKeyCode::KeyL => Key::KeyL,
            WKeyCode::KeyM => Key::KeyM,
            WKeyCode::KeyN => Key::KeyN,
            WKeyCode::KeyO => Key::KeyO,
            WKeyCode::KeyP => Key::KeyP,
            WKeyCode::KeyQ => Key::KeyQ,
            WKeyCode::KeyR => Key::KeyR,
            WKeyCode::KeyS => Key::KeyS,
            WKeyCode::KeyT => Key::KeyT,
            WKeyCode::KeyU => Key::KeyU,
            WKeyCode::KeyV => Key::KeyV,
            WKeyCode::KeyW => Key::KeyW,
            WKeyCode::KeyX => Key::KeyX,
            WKeyCode::KeyY => Key::KeyY,
            WKeyCode::KeyZ => Key::KeyZ,
            WKeyCode::ShiftLeft => Key::ShiftLeft,
            WKeyCode::ShiftRight => Key::ShiftRight,
            WKeyCode::AltLeft => Key::AltLeft,
            WKeyCode::AltRight => Key::AltRight,
            WKeyCode::ContextMenu => Key::ContextMenu,
            WKeyCode::CapsLock => Key::CapsLock,
            WKeyCode::ScrollLock => Key::ScrollLock,
            WKeyCode::NumLock => Key::NumLock,
            WKeyCode::PrintScreen => Key::PrintScreen,
            WKeyCode::Pause => Key::Pause,
            WKeyCode::Fn => Key::Fn,
            WKeyCode::FnLock => Key::FnLock,
            WKeyCode::F1 => Key::F1,
            WKeyCode::F2 => Key::F2,
            WKeyCode::F3 => Key::F3,
            WKeyCode::F4 => Key::F4,
            WKeyCode::F5 => Key::F5,
            WKeyCode::F6 => Key::F6,
            WKeyCode::F7 => Key::F7,
            WKeyCode::F8 => Key::F8,
            WKeyCode::F9 => Key::F9,
            WKeyCode::F10 => Key::F10,
            WKeyCode::F11 => Key::F11,
            WKeyCode::F12 => Key::F12,
            WKeyCode::Backquote => Key::Backquote,
            WKeyCode::NumpadMemoryStore => Key::NumpadMemoryStore,
            WKeyCode::ControlLeft => Key::ControlLeft,
            WKeyCode::ControlRight => Key::ControlRight,
            WKeyCode::Period => Key::Period,
            WKeyCode::Backspace => Key::Backspace,
            WKeyCode::Enter => Key::Enter,
            WKeyCode::Delete => Key::Delete,
            WKeyCode::NumpadEnter => Key::NumpadEnter,
            WKeyCode::Numpad0 => Key::Numpad0,
            WKeyCode::Numpad1 => Key::Numpad1,
            WKeyCode::Numpad2 => Key::Numpad2,
            WKeyCode::Numpad3 => Key::Numpad3,
            WKeyCode::Numpad4 => Key::Numpad4,
            WKeyCode::Numpad5 => Key::Numpad5,
            WKeyCode::Numpad6 => Key::Numpad6,
            WKeyCode::Numpad7 => Key::Numpad7,
            WKeyCode::Numpad8 => Key::Numpad8,
            WKeyCode::Numpad9 => Key::Numpad9,
            WKeyCode::NumpadAdd => Key::NumpadAdd,
            WKeyCode::NumpadSubtract => Key::NumpadSubtract,
            WKeyCode::NumpadMultiply => Key::NumpadMultiply,
            WKeyCode::NumpadDivide => Key::NumpadDivide,
            WKeyCode::NumpadDecimal => Key::NumpadDecimal,
            WKeyCode::NumpadComma => Key::NumpadComma,
            WKeyCode::Backslash => Key::Backslash,
            WKeyCode::BracketLeft => Key::BracketLeft,
            WKeyCode::BracketRight => Key::BracketRight,
            WKeyCode::Comma => Key::Comma,
            WKeyCode::IntlBackslash => Key::IntlBackslash,
            WKeyCode::IntlRo => Key::IntlRo,
            WKeyCode::IntlYen => Key::IntlYen,
            WKeyCode::Quote => Key::Quote,
            WKeyCode::Semicolon => Key::Semicolon,
            WKeyCode::Slash => Key::Slash,
            WKeyCode::End => Key::End,
            WKeyCode::Home => Key::Home,
            WKeyCode::Insert => Key::Insert,
            WKeyCode::PageDown => Key::PageDown,
            WKeyCode::PageUp => Key::PageUp,
            WKeyCode::ArrowDown => Key::ArrowDown,
            WKeyCode::ArrowLeft => Key::ArrowLeft,
            WKeyCode::ArrowRight => Key::ArrowRight,
            WKeyCode::ArrowUp => Key::ArrowUp,
            WKeyCode::NumpadBackspace => Key::NumpadBackspace,
            WKeyCode::NumpadClear => Key::NumpadClear,
            WKeyCode::NumpadClearEntry => Key::NumpadClearEntry,
            WKeyCode::NumpadEqual => Key::NumpadEqual,
            WKeyCode::NumpadHash => Key::NumpadHash,
            WKeyCode::NumpadMemoryAdd => Key::NumpadMemoryAdd,
            WKeyCode::NumpadMemoryClear => Key::NumpadMemoryClear,
            WKeyCode::NumpadMemoryRecall => Key::NumpadMemoryRecall,
            WKeyCode::NumpadMemorySubtract => Key::NumpadMemorySubtract,
            WKeyCode::NumpadParenLeft => Key::NumpadParenLeft,
            WKeyCode::NumpadParenRight => Key::NumpadParenRight,
            WKeyCode::NumpadStar => Key::NumpadStar,
            _ => Key::Unidentified,
        }
    }
}

pub static NUMBERS: LazyLock<HashSet<Key>> = LazyLock::new(|| {
    HashSet::from([
        Key::Digit0,
        Key::Digit1,
        Key::Digit2,
        Key::Digit3,
        Key::Digit4,
        Key::Digit5,
        Key::Digit6,
        Key::Digit7,
        Key::Digit8,
        Key::Digit9,
    ])
});

pub static CHARACTERS: LazyLock<HashSet<Key>> = LazyLock::new(|| {
    HashSet::from([
        Key::KeyA,
        Key::KeyB,
        Key::KeyC,
        Key::KeyD,
        Key::KeyE,
        Key::KeyF,
        Key::KeyG,
        Key::KeyH,
        Key::KeyI,
        Key::KeyJ,
        Key::KeyK,
        Key::KeyL,
        Key::KeyM,
        Key::KeyN,
        Key::KeyO,
        Key::KeyP,
        Key::KeyQ,
        Key::KeyR,
        Key::KeyS,
        Key::KeyT,
        Key::KeyU,
        Key::KeyV,
        Key::KeyW,
        Key::KeyX,
        Key::KeyY,
        Key::KeyZ,
    ])
});

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum MouseButton {
    Left,
    Right,
    Middle,
    Back,
    Forward,
    Other(u16),
}

impl MouseButton {
    fn from_winit(button: winit::event::MouseButton) -> Self {
        match button {
            WMouseButton::Left => MouseButton::Left,
            WMouseButton::Right => MouseButton::Right,
            WMouseButton::Middle => MouseButton::Middle,
            WMouseButton::Other(id) => MouseButton::Other(id),
            WMouseButton::Back => MouseButton::Back,
            WMouseButton::Forward => MouseButton::Forward,
        }
    }
}

#[allow(dead_code)]
mod tests {
    use super::*;

    fn key_down(input: &mut Input, code: KeyCode) {
        input.handle_key(&PhysicalKey::Code(code), &ElementState::Pressed);
    }

    fn key_up(input: &mut Input, code: KeyCode) {
        input.handle_key(&PhysicalKey::Code(code), &ElementState::Released);
    }

    fn mouse_down(input: &mut Input, button: WMouseButton) {
        input.handle_mouse_button(&button, &ElementState::Pressed);
    }

    fn mouse_up(input: &mut Input, button: WMouseButton) {
        input.handle_mouse_button(&button, &ElementState::Released);
    }

    #[test]
    fn test_keys() {
        let mut input = Input::default();
        key_down(&mut input, KeyCode::KeyA);
        key_down(&mut input, KeyCode::KeyB);
        key_up(&mut input, KeyCode::KeyB);
        input.next_frame();

        assert_eq!(input.key_pressed(&Key::KeyA), true);
        assert_eq!(input.key_pressed(&Key::KeyB), true);
        assert_eq!(input.key_released(&Key::KeyB), true);
        assert_eq!(input.key_held(&Key::KeyA), true);
        assert_eq!(input.key_held(&Key::KeyB), false);
    }

    #[test]
    fn test_mouse_buttons() {
        let mut input = Input::default();
        mouse_down(&mut input, WMouseButton::Left);
        mouse_down(&mut input, WMouseButton::Right);
        mouse_up(&mut input, WMouseButton::Right);
        input.next_frame();

        assert_eq!(input.mouse_clicked(&MouseButton::Left), true);
        assert_eq!(input.mouse_clicked(&MouseButton::Right), true);
        assert_eq!(input.mouse_button_held(&MouseButton::Left), true);
        assert_eq!(input.mouse_button_held(&MouseButton::Right), false);
    }

    #[test]
    fn test_mouse_move() {
        let mut input = Input::default();
        input.handle_mouse_move(&(1.0, 2.0));
        input.next_frame();

        assert_eq!(input.mouse_delta(), (1.0, 2.0));
    }

    #[test]
    fn test_mouse_scroll() {
        let mut input = Input::default();
        input.handle_mouse_scroll(&MouseScrollDelta::LineDelta(1.0, 2.0));
        input.next_frame();

        assert_eq!(input.mouse_scroll_delta(), Some((1.0, 2.0)));
    }

    #[test]
    fn test_key_events() {
        let mut input = Input::default();
        key_down(&mut input, KeyCode::KeyA);
        key_down(&mut input, KeyCode::KeyB);
        key_up(&mut input, KeyCode::KeyA);
        key_down(&mut input, KeyCode::KeyC);
        input.next_frame();

        let events = &input.last_frame.key_events;
        assert_eq!(events.len(), 4);
        assert_eq!(events[0], (Key::KeyA, KeyState::Down));
        assert_eq!(events[1], (Key::KeyB, KeyState::Down));
        assert_eq!(events[2], (Key::KeyA, KeyState::Up));
        assert_eq!(events[3], (Key::KeyC, KeyState::Down));

        assert_eq!(input.key_pressed(&Key::KeyA), true);
        assert_eq!(input.key_released(&Key::KeyA), true);
        assert_eq!(input.key_held(&Key::KeyA), false);
    }

    #[test]
    fn test_key_held_multiple_frames() {
        let mut input = Input::default();
        key_down(&mut input, KeyCode::KeyA);
        input.next_frame();
        input.next_frame();

        assert_eq!(input.key_held(&Key::KeyA), true);
        assert_eq!(input.key_pressed(&Key::KeyA), false);

        key_up(&mut input, KeyCode::KeyA);
        input.next_frame();

        assert_eq!(input.key_held(&Key::KeyA), false);
        assert_eq!(input.key_pressed(&Key::KeyA), false);
        assert_eq!(input.key_released(&Key::KeyA), true);
    }

    #[test]
    fn test_key_pressed_multiple_frames() {
        let mut input = Input::default();
        key_down(&mut input, KeyCode::KeyA);
        key_up(&mut input, KeyCode::KeyA);
        key_down(&mut input, KeyCode::KeyA);
        key_up(&mut input, KeyCode::KeyA);

        input.next_frame();

        assert_eq!(input.key_pressed(&Key::KeyA), true);
        assert_eq!(input.key_released(&Key::KeyA), true);
        assert_eq!(input.key_held(&Key::KeyA), false);
        key_up(&mut input, KeyCode::KeyA);

        input.next_frame();

        assert_eq!(input.key_released(&Key::KeyA), true);
    }

    #[test]
    fn test_mouse_scroll_multiple_events() {
        let mut input = Input::default();
        input.handle_mouse_scroll(&MouseScrollDelta::LineDelta(1.0, 2.0));
        input.handle_mouse_scroll(&MouseScrollDelta::LineDelta(3.0, -4.0));
        input.next_frame();

        assert_eq!(input.mouse_scroll_delta(), Some((4.0, -2.0)));
    }

    #[test]
    fn test_mouse_move_multiple_events() {
        let mut input = Input::default();
        input.handle_mouse_move(&(1.0, 2.0));
        input.handle_mouse_move(&(3.0, -4.0));
        input.next_frame();

        assert_eq!(input.mouse_delta(), (4.0, -2.0));
    }
}
