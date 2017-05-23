// XXX TODO:
// 1. Album list (as sortable/filterable table I think)
// 2. Search.
//   - Box accepting string input. Split into words.
//   - Use query API to find those words in any of (artist, title, version, track note, album, show note).  (Is this easy to do?  May have to run one query for each word and merge result.)
//   - Results will be (show ID, track ID) pairs.  Make a query to get those back.
//   - Render a special playlist using <ul> instead of <ol>.  Each track is otherwise rendered as usual.  Album of the week flag indicated per track, but overall AOTW is not shown.
//   - Link to each show.  Perhaps have an outer <ol> with show links?  Then nested <ol> for tracks on that show.
//   - Show link might include a query parameter which gives track numbers to highlight.  The renderer can then put a highlight on the entire track rendering (not the found substrings).  This may not be worth doing though.

;$(function () {

    $.widget('ui.rsabplaylist', {

        _create: function() {
            var self = this
            self.spreadsheet_key = $.trim($('.spreadsheet-key', self.element).hide().text())
            self.list_template = $('.list-template', self.element).hide().removeClass('list-template')
            self.track_template = $('.track-template', self.element).hide().removeClass('track-template')
            self.show_picker_template = $('.show-picker-template', self.element).hide().removeClass('show-picker-template')
            self.base_url = 'https://spreadsheets.google.com/spreadsheet/tq?key=' + encodeURIComponent(self.spreadsheet_key)
            self.spotify_embed_base = 'https://open.spotify.com/embed/user/theradarrsab/playlist/';
            self.spotify_link_base = 'https://open.spotify.com/user/theradarrsab/playlist/';
            self.various_artists_name = $.trim($('.various-artists', self.element).hide().text())
            self.params = null
            self.latest_show_metadata = null
            self.current_show_metadata = null
            self.current_show_details = null
            self.all_show_metadata_list = null
            self.all_show_metadata_by_number = {}
            self.date_options = null

            // Disable all buttons for now.
            self.element.find('.nav button').attr('disabled', 'disabled');
            self.element.find('.nav-group-date').hide().find('select').attr('disabled', 'disabled');

            // First: list all shows ascending (the underlying function always
            // picks the first in the list, which will be the earliest entry).
            self.element.find('.nav .nav-first').click(function () {
                self.set_current_show_metadata_for_number(
                    self.all_show_metadata_list[0].number
                );
            })
            // Previous: list all shows before the current one, descending (so
            // the first in the list will be the latest one before the current
            // one).
            self.element.find('.nav .nav-previous').click(function () {
                if(self.current_show_metadata !== null) {
                    var index = self.current_show_metadata._list_index
                    if(index !== 0) {
                        index -= 1
                    }
                    self.set_current_show_metadata_for_number(
                        self.all_show_metadata_list[index].number
                    );
                };
            })
            // Next: list all shows after the current one, ascending (so the
            // first in the list will be the earliest one after the current
            // one).
            self.element.find('.nav .nav-next').click(function () {
                if(self.current_show_metadata !== null) {
                    var index = self.current_show_metadata._list_index
                    if(index < self.all_show_metadata_list.length - 1) {
                        index += 1
                    }
                    self.set_current_show_metadata_for_number(
                        self.all_show_metadata_list[index].number
                    );
                };
            })
            // Last: list all shows descending (the underlying function always
            // picks the first in the list, which will be the latest entry).
            self.element.find('.nav .nav-last').click(function () {
                self.set_current_show_metadata_for_number(null);
            })

            // Random: picks a random show number.
            self.element.find('.nav .nav-random').click(function () {
                self._set_random_show_metadata();
            });

            // If a show was requested through the URL, get it.
            var requested_show_number = self._get_param('sn', '');
            if(requested_show_number.toLowerCase() === 'rnd') {
                self._set_random_show_metadata();
            }
            else {
                requested_show_number = parseInt(requested_show_number, 10);
                self.set_current_show_metadata_for_number(
                    requested_show_number ? requested_show_number : null
                )
            }
        },

        // http://stackoverflow.com/a/7228322
        _generate_random_int: function(min, max) {
            return Math.floor(Math.random()*(max-min+1)+min);
        },

        _basic_get_metadata_callback: function() {
            if(this.latest_show_metadata !== null && this.current_show_metadata !== null) {
                this._get_and_render_playlist(this.current_show_metadata);
            }
        },

        _read_params: function() {
            if(this.params === null) {
                this.params = {}
                var split_hash = window.location.hash.slice(1).split('&');
                var key, value, item, pos;
                for(i = 0; i < split_hash.length; i++) {
                    item = split_hash[i]
                    pos = item.indexOf('=');
                    if(pos == -1) {
                        key = decodeURIComponent(item);
                        value = '';
                    }
                    else {
                        key = decodeURIComponent(item.slice(0, pos));
                        value = decodeURIComponent(item.slice(pos+1));
                    }
                    if(key) {
                        this.params[key] = value;
                    };
                }
            }
        },

        _get_param: function(key, default_value) {
            this._read_params();
            if(key in this.params) {
                return this.params[key];
            }
            return default_value;
        },

        _set_param: function(key, value) {
            this._read_params();
            if(value === undefined) {
                delete this.params[key];
            }
            else {
                this.params[key] = value;
            }
            this._write_params();
        },

        _write_params: function() {
            this._read_params();
            var hash_items = [];
            var key, value;
            for(key in this.params) {
                value = this.params[key];
                if(key === '' || value === null || value === undefined) {
                    continue;
                }
                hash_items.push(encodeURIComponent(key) + '=' + encodeURIComponent(value));
            }
            window.location.hash = '#' + hash_items.join('&');
        },

        // Private function; use 'set_current_show_metadata_for_number' instead.
        _get_all_show_metadata: function(callback) {
            var self = this;
            var url = this.base_url
                + '&sheet=Shows'
                + '&tq='
                + 'where B is not null';
            this.element.find('.loading').show();
            var query = new google.visualization.Query(url);
            query.send(
                function (response) {
                    self.all_show_metadata_list = self._get_show_metadata_from_response(response);
                    var metadata = null;
                    for(var i = 0; i < self.all_show_metadata_list.length; i++) {
                        metadata = self.all_show_metadata_list[i]
                        metadata._list_index = i
                        self.all_show_metadata_by_number[metadata.number] = metadata
                    }
                    self.latest_show_metadata = metadata; // last one processed
                    if(callback === undefined) {
                        self._basic_get_metadata_callback();
                    }
                    else {
                        callback();
                    }
                }
            );
        },

        // Handle the response from a query to get a number of shows' metadata.
        _get_show_metadata_from_response: function(response) {
            if(response.isError()) {
                console.log('Error: ' + response.getMessage() + '\n' + response.getDetailedMessage());
                return [];
            }
            var data = response.getDataTable();
            var key, value, values;
            var metadata_list = [];
            var metadata = null;
            var defn = {
                'id': 0,
                'number': 1,
                'date': 2,
                'title': 3,
                'note': 4,
                'spotify': 6
            }
            var ordered_row_indexes = data.getSortedRows(2); // date
            var index = 0;
            for(var i=0; i<ordered_row_indexes.length; i++) {
                index = ordered_row_indexes[i];
                metadata = {}
                for(key in defn) {
                    metadata[key] = data.getValue(index, defn[key]);
                }
                metadata_list.push(metadata)
            }
            return metadata_list;
        },

        // 'number' may be null (latest), an integer, or a 0-arg function.
        set_current_show_metadata_for_number: function(number, callback) {
            var self = this;
            function callback_helper(response) {
                if(typeof number === "function") {
                    number = number();
                }
                if(number !== null && number in self.all_show_metadata_by_number) {
                    self.current_show_metadata = self.all_show_metadata_by_number[number]
                }
                else {
                    self.current_show_metadata = self.latest_show_metadata
                }
                if(callback === undefined) {
                    self._basic_get_metadata_callback();
                }
                else {
                    callback();
                }
            };
            if(self.all_show_metadata_list === null) {
                self._get_all_show_metadata(callback_helper);
            }
            else {
                callback_helper(null);
            }
        },

        _set_random_show_metadata: function() {
            var self = this;
            self.set_current_show_metadata_for_number(
                function () {
                    var index = self._generate_random_int(1, self.all_show_metadata_list.length)
                    return self.all_show_metadata_list[index].number
                }
            )
        },

        _get_and_render_playlist: function(show_metadata) {
            var self = this
            var url = self.base_url
                + '&sheet=Playlists'
                + '&tq=' + encodeURIComponent('where A = ' + show_metadata.id);
            var query = new google.visualization.Query(url);
            this.element.find('.loading').show();
            query.send(function(response) {
                self._render_playlist_from_response(response)
            });
        },

        // Callback for response which holds a show's details.  Store the
        // details on self, then render a playlist.
        _render_playlist_from_response: function(response) {
            if(response.isError()) {
                console.log('Error: ' + response.getMessage() + '\n' + response.getDetailedMessage());
                return;
            }
            this.current_show_details = {
                'aotw_album': null,
                'aotw_artist': null,
                tracks: []
            }
            var data = response.getDataTable();
            var ordered_row_indexes = data.getSortedRows(1); // track number in show
            var rendered_list = this.list_template.clone().show()
            rendered_list.find('.show-number').text(this.current_show_metadata.number)
            rendered_list.find('.date').text($.datepicker.formatDate('d MM yy', this.current_show_metadata.date))
            rendered_list.find('.count').text(ordered_row_indexes.length)
            for(var i = 0; i < ordered_row_indexes.length; i++) {
                var row_index = ordered_row_indexes[i];
                var track = {
                    'number': data.getFormattedValue(row_index, 1),
                    'artist': data.getFormattedValue(row_index, 2),
                    'title': data.getFormattedValue(row_index, 3),
                    'version': data.getFormattedValue(row_index, 4),
                    'song_note': data.getFormattedValue(row_index, 5),
                    'album': data.getFormattedValue(row_index, 6),
                    'is_aotw': Boolean(data.getValue(row_index, 7))
                }
                this.current_show_details.tracks.push(track)
                if(track.is_aotw) {
                    if(this.current_show_details.aotw_artist === null) {
                        this.current_show_details.aotw_album = track.album;
                        this.current_show_details.aotw_artist = track.artist;
                    }
                    else if(this.current_show_details.aotw_artist !== track.artist) {
                        this.current_show_details.aotw_artist = ''; // means "various"
                    }
                }
            }
            this.render_playlist()
        },

        _render_text: function (selector, text, autolink) {
            var show_hide_element = $(selector);
            var content_element = show_hide_element.find('.content');
            if(content_element.length == 0) {
                content_element = show_hide_element;
                show_hide_element = null;
            }
            if (text === null) {
                text = '';
            }
            if(autolink && typeof Autolinker !== 'undefined') {
                text = Autolinker.link(text, {stripPrefix: false})
                content_element.html(text)
            }
            else {
                content_element.text(text)
            }
            if(show_hide_element !== null) {
                if(text) {
                    show_hide_element.show()
                }
                else {
                    show_hide_element.hide()
                }
            }
            return show_hide_element;
        },

         _get_date_number_suffix: function(n) {
            var r = (n-1) % 10;
            if(r < 3 && n > 0 && (n < 10 || n > 20)) {
                return ['st', 'nd', 'rd'][r];
            }
            return 'th';
        },

        render_playlist: function() {
            if(this.current_show_metadata === null || this.current_show_details === null) {
                console.log('No current show: ' + this.current_show_metadata + ' ' + this.current_show_details)
                return;
            }
            this._set_param('sn', this.current_show_metadata.number);
            var rendered_list = this.list_template.clone().show()
            rendered_list.find('.show-number').text(this.current_show_metadata.number)
            rendered_list.find('.date').text($.datepicker.formatDate('d MM yy', this.current_show_metadata.date))
            rendered_list.find('.count').text(this.current_show_details.tracks.length)
            for(var i = 0; i < this.current_show_details.tracks.length; i++) {
                var track = this.current_show_details.tracks[i]
                var rendered_track = this.track_template.clone().show()
                if(track.is_aotw) {
                    rendered_track.find('.is_aotw').show()
                }
                else {
                    rendered_track.find('.is_aotw').hide()
                }
                this._render_text(rendered_track.find('.artist'), track.artist)
                this._render_text(rendered_track.find('.title'), track.title)
                this._render_text(rendered_track.find('.version'), track.version)
                this._render_text(rendered_track.find('.album'), track.album)
                this._render_text(rendered_track.find('.note'), track.song_note, true)
                rendered_list.find('.list-content').append(rendered_track)
            }
            if(this.current_show_details.aotw_album === null) {
                rendered_list.find('.aotw').hide()
            }
            else {
                rendered_list.find('.aotw').show()
                this._render_text(
                    rendered_list.find('.aotw .artist'),
                    this.current_show_details.aotw_artist ? this.current_show_details.aotw_artist : this.various_artists_name
                )
                this._render_text(rendered_list.find('.aotw .album'), this.current_show_details.aotw_album)
            }
            if(this.current_show_metadata.spotify === '') {
                rendered_list.find('.spotify').hide();
            }
            else {
                rendered_list.find('.spotify').show()
                    .children('iframe')
                    .attr(
                        'src',
                        (this.current_show_metadata.spotify === '')
                        ? ''
                        : this.spotify_embed_base + this.current_show_metadata.spotify
                    );
            }
            this._render_text(rendered_list.find('.show-title'), this.current_show_metadata.title)
            this._render_text(rendered_list.find('.show-note'), this.current_show_metadata.note, true)
            this.element.find('.loading').hide()
            this.element.find('.main-content').html(rendered_list)

            if(this.current_show_metadata.number >= this.latest_show_metadata.number) {
                this.element.find('.nav-next, .nav-last').attr('disabled', 'disabled');
            }
            else {
                this.element.find('.nav-next, .nav-last').removeAttr('disabled');
            }
            if(this.current_show_metadata.number === 1) {
                this.element.find('.nav-previous, .nav-first').attr('disabled', 'disabled');
            }
            else {
                this.element.find('.nav-previous, .nav-first').removeAttr('disabled');
            }
            this.element.find('.nav-random').removeAttr('disabled');
            this.update_date_nav();
        },

        update_date_nav: function() {
            var initialising = (this.date_options === null)
            var self = this;

            if(initialising) {
                this.date_options = {}
                var metadata, last_year = null, year, date_options_list, date_string;
                var months = [];
                this.element.find('.nav-month-names span').each(function () {
                    months.push($(this).text());
                });
                this.element.find('.nav-year').empty();
                for(var i = 0; i < this.all_show_metadata_list.length; i++) {
                    var rendered_picker_item = $(self.show_picker_template).clone().show();
                    metadata = this.all_show_metadata_list[i];
                    year = metadata.date.getFullYear();
                    if(year !== last_year) {
                        last_year = year;
                        this.element.find('.nav-year').append($('<option>').attr('value', year).text(year))
                        date_options_list = [$('<option>').attr('value', '').text('...')];
                        this.date_options[year] = date_options_list;
                    }
                    this._render_text(rendered_picker_item.find('.month'), metadata.date.getMonth());
                    this._render_text(rendered_picker_item.find('.month-name'), months[metadata.date.getMonth()]);
                    this._render_text(rendered_picker_item.find('.day'), metadata.date.getDate());
                    this._render_text(rendered_picker_item.find('.day-suffix'), this._get_date_number_suffix(metadata.date.getDate()));
                    this._render_text(rendered_picker_item.find('.show-number'), metadata.number);
                    this._render_text(rendered_picker_item.find('.title'), metadata.title);
                    // Remove parts that have been hidden before turning into
                    // text.  (We can't use the ':hidden' selector as the item
                    // is not in the page, so jQuery can't figure it out.)
                    $('*', rendered_picker_item)
                        .filter(function () { return $(this).css('display') === 'none'})
                        .remove()
                    date_options_list.push($('<option>').attr('value', metadata.number).text(rendered_picker_item.text()));
                }

                // 1. Year: when it changes, push a new set of options into the
                // date select (selecting "...")
                this.element.find('.nav-group-date .nav-year').change(function () {
                    var date_dropdown = self.element.find('.nav-group-date .nav-date')
                    var date_options_list = self.date_options[parseInt($(this).val(), 10)]
                    date_dropdown.empty()
                    for(var i = 0; i < date_options_list.length; i++) {
                        date_dropdown.append(date_options_list[i])
                    }
                })
                // 2. Date: when it changes, if it isn't "..." or current show,
                // trigger a nav.
                this.element.find('.nav-group-date .nav-date').change(function () {
                    var val = $(this).val()
                    if(val !== '') {
                        val = parseInt(val, 10)
                    }
                    if(val !== '' && val != self.current_show_metadata.number) {
                        self.set_current_show_metadata_for_number(val)
                    }
                })
            }

            // Update current value (this is what happens most times this
            // function is called, whether we're initialising or not).
            var last_year = parseInt(this.element.find('.nav-group-date .nav-year').val(), 10)
            var year = this.current_show_metadata.date.getFullYear()
            if(initialising || last_year !== year) {
                this.element.find('.nav-group-date .nav-year').val(year).change()
            }
            self.element.find('.nav-group-date .nav-date').val(this.current_show_metadata.number)
            if(initialising) {
                this.element.find('.nav-group-date').show().find('select').removeAttr('disabled')
            }
        }

    });
});
