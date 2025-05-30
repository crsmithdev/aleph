use {
    crate::{Ptr, Res, ResMut, Resources, SystemParam},
    downcast_rs::{impl_downcast, Downcast},
    std::any::TypeId,
};

pub trait Event: 'static {}

#[derive(Default)]
pub struct Events<T>
where
    T: 'static,
{
    last_frame: Vec<T>,
    current_frame: Vec<T>,
}

impl<T> Events<T>
where
    T: 'static,
{
    pub fn new() -> Self {
        Self {
            last_frame: Vec::new(),
            current_frame: Vec::new(),
        }
    }

    pub fn read(&self) -> impl Iterator<Item = &T> { self.last_frame.iter() }

    pub fn write(&mut self, event: T) { self.current_frame.push(event); }

    fn swap_buffers(&mut self) {
        std::mem::swap(&mut self.last_frame, &mut self.current_frame);
        self.current_frame.clear();
    }
}

pub trait EventsDyn: Downcast + 'static {
    fn update(&mut self);
}

impl<T> EventsDyn for Events<T>
where
    T: 'static,
{
    fn update(&mut self) { self.swap_buffers(); }
}

impl_downcast!(EventsDyn);

pub struct EventReader<'a, T: 'static> {
    pub events: Res<'a, Events<T>>,
}

impl<'a, T> EventReader<'a, T> {
    pub fn read(&self) -> impl Iterator<Item = &T> { self.events.read() }
    pub fn last(&self) -> Option<&T> { self.events.last_frame.last() }
}

impl<'a, T> SystemParam for EventReader<'a, T> {
    type Item<'new> = EventReader<'new, T>;

    fn retrieve<'r>(resources: &'r Resources) -> Self::Item<'r> {
        let param = <Res<'r, Events<T>> as SystemParam>::retrieve(resources);
        EventReader { events: param }
    }
}

pub struct EventWriter<'a, T: 'static> {
    events: ResMut<'a, Events<T>>,
}

impl<'a, T> EventWriter<'a, T> {
    pub fn write(&mut self, event: T) { self.events.current_frame.push(event); }
}

struct EventRegistration {
    type_id: TypeId,
    update: fn(Ptr),
}

#[derive(Default)]
pub struct EventRegistry {
    registered_events: Vec<EventRegistration>,
}

impl EventRegistry {
    pub fn register<'a, T: Event>(&mut self, resources: &mut Resources) {
        let events = Events::<T>::new();
        resources.add(events);

        self.registered_events.push(EventRegistration {
            type_id: TypeId::of::<Events<T>>(),
            update: |ptr| {
                let events = ptr.as_mut::<Events<T>>();
                events.swap_buffers();
            },
        });
    }

    pub fn next_frame(&mut self, resources: &Resources) {
        for reg in self.registered_events.iter_mut() {
            let ptr = resources.get_ptr(reg.type_id);
            (reg.update)(ptr);
        }
    }
}

pub struct GuiEvent(pub winit::event::WindowEvent);
impl Event for GuiEvent {}

pub struct ResizedEvent {
    pub width: u32,
    pub height: u32,
}
impl Event for ResizedEvent {}

#[cfg(test)]
mod test {
    use {
        super::*,
        crate::system::{Schedule, Scheduler},
    };

    #[derive(Debug, PartialEq)]
    struct TestEvent(u32);
    impl Event for TestEvent {}

    #[test]
    fn test_2() {
        let mut resources = Resources::default();
        let mut registry = EventRegistry::default();
        registry.register::<TestEvent>(&mut resources);

        let mut scheduler = Scheduler::default();
        scheduler.add_system(Schedule::Default, |v2: EventReader<TestEvent>| {
            let events = v2.read().collect::<Vec<_>>();
            assert_eq!(events.len(), 1);
            assert_eq!(events[0], &TestEvent(1));
        });

        let events = resources.get_mut::<Events<TestEvent>>();
        events.write(TestEvent(1));
        registry.next_frame(&mut resources);
        scheduler.run(Schedule::Default, &mut resources);
    }
}
