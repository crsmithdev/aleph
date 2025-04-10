use {
    glam::Vec2,
    std::collections::HashSet,
    winit::{
        event::{DeviceEvent, ElementState, MouseButton, WindowEvent},
        keyboard::Key,
    },
};

#[derive(Default, Debug)]
pub struct Input {
    state: InputState,
}

impl Input {
    pub fn handle_device_event(&mut self, event: &DeviceEvent) {
        self.state.handle_device_event(event);
    }
    pub fn handle_window_event(&mut self, event: &WindowEvent) { self.state.handle_event(event); }
    pub fn next_frame(&mut self) -> InputState {
        let next_state = InputState::default();
        let prev_state = std::mem::replace(&mut self.state, next_state);

        self.state.keys_held = prev_state.keys_held.clone();
        self.state.mouse_held = prev_state.mouse_held.clone();

        prev_state
    }
}

#[derive(Default, Debug)]
pub struct InputState {
    keys_pressed: HashSet<Key>,
    keys_held: HashSet<Key>,
    mouse_pressed: HashSet<MouseButton>,
    mouse_held: HashSet<MouseButton>,
    mouse_delta: Option<Vec2>,
    mouse_scroll_delta: Option<f32>,
}

impl InputState {
    pub fn key_pressed(&self, key: &Key) -> bool { self.keys_pressed.contains(key) }

    pub fn mouse_held(&self, button: &MouseButton) -> bool { self.mouse_held.contains(button) }

    pub fn mouse_delta(&self) -> Option<Vec2> { self.mouse_delta }

    pub fn mouse_scroll_delta(&self) -> Option<f32> { self.mouse_scroll_delta }

    fn handle_device_event(&mut self, event: &DeviceEvent) {
        match event {
            DeviceEvent::MouseMotion { delta } => {
                let new = Vec2::new(delta.0 as f32, delta.1 as f32);
                self.mouse_delta = match self.mouse_delta {
                    Some(d) => Some(d + new),
                    None => Some(new),
                };
            }
            _ => {}
        }
    }

    fn handle_event(&mut self, event: &WindowEvent) {
        match event {
            WindowEvent::KeyboardInput { event, .. } => {
                let key = &event.logical_key;
                let _ = match event.state {
                    ElementState::Pressed => {
                        if !self.keys_held.contains(key) {
                            self.keys_pressed.insert(key.clone());
                        }
                        self.keys_held.insert(key.clone())
                    }
                    ElementState::Released => self.keys_held.remove(key),
                };
            }
            WindowEvent::MouseInput { state, button, .. } => {
                let _ = match state {
                    ElementState::Pressed => {
                        if !self.mouse_held.contains(button) {
                            self.mouse_pressed.insert(button.clone());
                        }
                        self.mouse_held.insert(button.clone())
                    }
                    ElementState::Released => self.mouse_held.remove(button),
                };
            }
            WindowEvent::MouseWheel { delta, .. } => {
                let delta = match delta {
                    winit::event::MouseScrollDelta::LineDelta(_, y) => *y,
                    winit::event::MouseScrollDelta::PixelDelta(pos) => pos.y as f32,
                };
                self.mouse_scroll_delta = Some(delta);
            }
            _ => {}
        }
    }
}
