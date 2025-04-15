use {
    crate::{input::InputState, layer::LayerDyn, Layer},
    downcast_rs::{impl_downcast, Downcast},
    std::{any::TypeId, collections::HashMap},
};

pub trait Event: 'static + Downcast + std::fmt::Debug {}
impl_downcast!(Event);

type BoxedEventCallback = Box<dyn FnMut(&mut dyn LayerDyn, &dyn Event) -> anyhow::Result<()>>;

pub struct EventContext {}

pub struct EventSubscriber<'a, L> {
    index: usize,
    registry: &'a mut EventRegistry,
    _marker: std::marker::PhantomData<L>,
}

impl<'a, L: Layer> EventSubscriber<'a, L> {
    pub(crate) fn new(registry: &'a mut EventRegistry, index: usize) -> Self {
        Self {
            index,
            registry,
            _marker: std::marker::PhantomData,
        }
    }

    pub fn subscribe<T: Event>(
        &mut self,
        callback: impl 'static + Fn(&mut L, &T) -> anyhow::Result<()>,
    ) {
        self.registry.register::<T>(
            self.index,
            Box::new(move |layer: &mut dyn LayerDyn, event: &dyn Event| {
                let layer = layer
                    .downcast_mut::<L>()
                    .expect("Error downcasting receiving layer");
                let event = event.downcast_ref::<T>().expect("Error downcasting event");

                callback(layer, event)
            }),
        );
    }
}

#[derive(Default)]
pub struct EventRegistry {
    callbacks: Vec<BoxedEventCallback>,
    listeners: HashMap<TypeId, Vec<(usize, usize)>>,
}

impl EventRegistry {
    pub fn register<T: Event>(&mut self, index: usize, callback: BoxedEventCallback) {
        let type_id = TypeId::of::<T>();
        let listeners = self.listeners.entry(type_id).or_default();
        self.callbacks.push(callback);
        listeners.push((index, self.callbacks.len() - 1));
    }
    pub fn emit<T: Event>(
        &mut self,
        layers: &mut [Box<dyn LayerDyn>],
        event: &T,
    ) -> anyhow::Result<()> {
        let type_id = TypeId::of::<T>();
        if let Some(callbacks) = self.listeners.get(&type_id) {
            for (layer_index, callback_index) in callbacks {
                let layer = layers[*layer_index].as_mut();
                let callback = self.callbacks[*callback_index].as_mut();
                callback(layer, event)?;
            }
        }

        Ok(())
    }
}

#[derive(Debug)]
pub struct TickEvent {
    pub input: InputState,
}
impl Event for TickEvent {}

#[derive(Debug)]
pub struct GuiEvent {
    pub event: winit::event::WindowEvent,
}

impl Event for GuiEvent {}