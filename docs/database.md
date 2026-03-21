# Схема базы данных (Database Schema)

База данных реализована на PostgreSQL внутри Supabase.

## Основные таблицы

### `users`
- `id`: UUID (Primary Key).
- `telegram_id`: ID пользователя в Telegram.
- `name`: Имя пользователя.
- `username`: Имя пользователя в Telegram (с @).
- `phone`: Контактный номер (если указан).
- `avatar_url`: Ссылка на фото профиля.
- `car_details`: Данные об автомобиле (Json: модель, цвет, номер).
- `is_driver`: Флаг, указывающий на роль водителя.

### `rides`
- `id`: UUID.
- `driver_id`: Ссылка на `users.id`.
- `from_city`, `to_city`: Города отправления и прибытия.
- `date`, `time`: Дата и время рейса.
- `seats`: Количество доступных мест.
- `price`: Базовая цена или Json с ценами по рядам (для автобусов).
- `status`: `active`, `completed`, `cancelled`.
- `is_passenger_entry`: Флаг (True, если это заявка от пассажира).

### `bookings`
- `id`: UUID.
- `ride_id`: Ссылка на `rides.id`.
- `passenger_id`: Ссылка на `users.id`.
- `seats_booked`: Количество забронированных мест.
- `status`: `pending`, `confirmed`, `cancelled`.
- `passenger_data`: Json с деталями пассажиров (ФИО, паспорт, место).

### `cities`
- `id`: UUID.
- `name`: Название города.
- `type`: `ride` (авто) или `bus` (автобус).

## Row Level Security (RLS)
В Supabase настроены политики безопасности, ограничивающие доступ к данным:
- Пользователи могут редактировать только свои профили.
- Водители могут видеть список своих бронирований.
- Публичные данные (города, активные рейсы) доступны для чтения всем авторизованным пользователям.
